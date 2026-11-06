# Technical Decisions

## 001: Hand-written SQL with pgx

- **Decision:** Use `pgx/v5` directly, with every query in `internal/store`.
- **Alternatives:** GORM, sqlc.
- **Why:** The queries are few, and the ownership filter in each one is the main security control, so it should be visible in the code. An ORM would hide it. sqlc is a good fit too, but adds a code generation step that this query count does not justify.

## 002: Customer identity comes only from the JWT

- **Decision:** Handlers read the customer ID from the context set by the auth middleware. No route accepts it in the path, query or body, and unknown JSON fields are rejected.
- **Alternatives:** Pass `customer_id` from the agent; check ownership in the agent service.
- **Why:** The agent's arguments are influenced by LLM output, which prompt injection can control. Enforcing ownership in the Go API means a fully compromised agent still cannot read another customer's data.

## 003: Other customers' orders return 404

- **Decision:** A foreign order and a missing order produce byte-identical responses.
- **Alternatives:** Return 403 for foreign orders.
- **Why:** A 403 confirms that the order exists, which allows order IDs to be enumerated.

## 004: Duplicate returns are blocked by a partial unique index

- **Decision:** `UNIQUE (order_id) WHERE status <> 'rejected'`. The store translates the unique violation into `ErrReturnExists`.
- **Alternatives:** Check for an existing return in application code first; use `SELECT ... FOR UPDATE`.
- **Why:** A check followed by an insert lets two concurrent requests both pass. The index holds regardless of how many instances run. It covers refunded returns as well, so a refunded order cannot be returned twice; only a rejected return can be retried.

## 005: Migrations with goose, embedded in the binary

- **Decision:** Plain SQL migrations embedded with `go:embed` and applied on startup through `goose`.
- **Alternatives:** golang-migrate, `docker-entrypoint-initdb.d` scripts.
- **Why:** The init directory runs only on an empty volume, so it cannot evolve a schema. goose's provider API works as a library without global state. Applying on startup suits this single-instance project; a multi-instance deployment would run migrations as a separate step.

## 006: Text IDs for orders and customers

- **Decision:** `DA-100001` and `CUS-1001` as primary keys, validated by `CHECK` constraints.
- **Alternatives:** UUIDs, integer sequences.
- **Why:** Customers type order numbers into the chat, so the ID has to be short enough to read and say. The API does not rely on IDs being unguessable, because every query is scoped to the customer.

## 007: Money as integer kuruş

- **Decision:** Store and return amounts as `BIGINT` kuruş.
- **Alternatives:** `NUMERIC`, floating point.
- **Why:** Integers avoid float rounding in both Go and JSON. `NUMERIC` would be correct as well, but needs a decimal type on the Go side.

## 008: Seed data with relative dates

- **Decision:** `seed.sql` computes dates from `now()`. Server startup seeds only an empty database; `cmd/seed` replaces the data on demand.
- **Alternatives:** Fixed dates; Go-based random data generation.
- **Why:** Fixed dates would silently invalidate the 14-day return scenarios. Fixed IDs keep the data deterministic, so tests and later eval scenarios can refer to specific orders. Tests reuse the seed as fixtures, so it stays correct.

## 009: Integration tests against real Postgres

- **Decision:** Tests run through `httptest` against a separate `destekai_test` database in the compose Postgres.
- **Alternatives:** Mock the store; testcontainers.
- **Why:** Ownership filters, the unique index and the concurrency guarantee live in SQL, so mocks would not test them. testcontainers would add a dependency that the existing container makes unnecessary.

## 010: Own LLMClient instead of LangChain chat models

- **Decision:** LangGraph runs the agent loop, while a small `LLMClient` protocol with Gemini and Ollama implementations talks to the models.
- **Alternatives:** `langchain-google-genai` and `langchain-ollama`; LangGraph's prebuilt `create_react_agent`.
- **Why:** The interface is about 15 lines, and provider details such as thought signatures stay visible and testable. Scripted fakes can stand in for the model, so tests use no quota. The cost is writing message conversion by hand.

## 011: The session token travels in LangGraph context

- **Decision:** The JWT is passed as run `context`, read only by the tool node and forwarded to the order API. Tool schemas have no identity parameters.
- **Alternatives:** Put it in state, or in `config.configurable` as first planned.
- **Why:** State is checkpointed and sent to the model. Configurable values can be copied into checkpoint metadata. Context is never persisted, and a test asserts that the token appears in neither the model input nor the checkpoints.

## 012: The agent service verifies the JWT as well

- **Decision:** `/v1/chat` verifies the token with PyJWT and builds the thread ID as `customer_id:conversation_id`.
- **Alternatives:** Forward the token unchecked and leave authentication to the order API.
- **Why:** Conversation memory lives in this service, so the order API cannot protect it. Without a verified customer, knowing a conversation ID would be enough to read someone's chat.

## 013: In-memory conversation memory for now

- **Decision:** Use LangGraph's `InMemorySaver`.
- **Alternatives:** A Postgres checkpointer.
- **Why:** Enough for the current phases. Memory is lost on restart, and only one instance can run. Concurrent messages in the same conversation are not serialized; the chat UI sends one at a time. Swapping the saver is a one-line change plus a dependency.

## 014: Retries stop once output has started

- **Decision:** `RetryingLLMClient` retries 429, 503, 504 and timeouts with exponential backoff and jitter, honors the provider's delay, and fails immediately if that delay exceeds 30 seconds or any event has already been streamed. Gemini calls time out after 30 seconds, with at most two retries, which caps a stalled request at about 95 seconds.
- **Alternatives:** Retry the whole stream; retry 429 only, as the requirement states.
- **Why:** A mid-stream retry would show the customer repeated text. A long provider delay usually means an exhausted daily quota, where waiting only hangs the request. 503 and 504 are included because overloaded Gemini models return them, and live testing showed a request stalling for three minutes without a timeout.

## 015: Tool failures are returned to the model as data

- **Decision:** `execute_tool` turns order API errors and invalid arguments into `{"error": code}` results. Order IDs are validated before they enter a URL.
- **Alternatives:** Raise and end the run.
- **Why:** The model can then explain "this order was not found" to the customer in Turkish. Model output is untrusted, so the ID check stops path traversal such as `../../admin`.

## 016: SSE over POST

- **Decision:** `POST /v1/chat` streams `token`, `tool_call`, `tool_result`, `done` and `error` events.
- **Alternatives:** Browser `EventSource` over GET; WebSockets.
- **Why:** `EventSource` cannot send an Authorization header, and a GET would put the message in URLs and logs. Traffic is one-way per message, so WebSockets would add connection handling without benefit. The frontend will read the stream with `fetch`.

## 017: gemini-3.6-flash as the default model

- **Decision:** Default `LLM_MODEL` to `gemini-3.6-flash`.
- **Alternatives:** `gemini-3.8-flash`, the example in the project brief.
- **Why:** During live testing on 2026-11-01, 3.8 and 3.7 returned 504 for every request on our API key, while 3.6 answered in about two seconds and completed the full tool flow. The cause was not determined and may be temporary. The model is one environment variable, so this is easy to revisit.

## 018: asyncpg for the policy index

- **Decision:** Use `asyncpg` with the `pgvector` codec.
- **Alternatives:** `psycopg`, as first planned.
- **Why:** psycopg's async mode does not run on Windows' default event loop, which would have forced a test workaround. asyncpg also ships its own pool, so one package covers both needs.

## 019: Fixed 768-dimension vectors

- **Decision:** `vector(768)` with an HNSW cosine index. Gemini output is reduced to 768 dimensions.
- **Alternatives:** Full 3072 dimensions with `halfvec`; a column per model.
- **Why:** HNSW on `vector` stops at 2000 dimensions. `multilingual-e5-base` produces 768 natively, so switching providers needs no schema change. Each row records its model, and search filters on it, because vectors from different models are not comparable.

## 020: A restricted database role for the agent service

- **Decision:** The agent service and indexer connect as `destekai_agent`, which has rights only on `policy_chunks`. Its password comes from `.env` and is applied by the order API at startup.
- **Alternatives:** Reuse the owner role; add a policy endpoint to the order API.
- **Why:** Decision 002 relies on the order API being the only path to customer data. Sharing the owner role would have opened a second path. A test asserts that the role is refused on customer tables.

## 021: Chunk by heading, with context in the text

- **Decision:** Split at `##` headings, and at paragraphs above 1000 characters with one paragraph of overlap. Each chunk starts with the document and section title.
- **Alternatives:** Fixed-size windows; semantic chunking.
- **Why:** The policies are short and already organized by topic, so headings are the natural unit. Fixed windows would cut rules in half. The title gives a chunk meaning on its own, and the eval needs stable section names as ground truth.

## 022: gemini-embedding-001 and a 0.65 similarity threshold

- **Decision:** Default to `gemini-embedding-001` and drop hits below 0.65.
- **Alternatives:** `gemini-embedding-2`; returning the top results without a threshold.
- **Why:** `gemini-embedding-2` returned one vector for a batch of texts, so it does not fit the batch interface; `zip(strict=True)` caught this. On 26 in-scope questions, 001 gave recall@4 of 0.96 and MRR of 0.94. The weakest expected match scored 0.69, and six of seven out-of-scope questions scored at most 0.64. The threshold was tuned on this small set, not validated on a separate one.
- **Limit:** A threshold cannot catch a related question that the documents do not answer. "Yurt dışına kargo gönderiyor musunuz?" scored 0.71, so that case depends on the system prompt, and Phase 6 has to measure it.

## 023: Vector search only, for now

- **Decision:** No hybrid search.
- **Alternatives:** Combine with Postgres `turkish` full-text search.
- **Why:** Recall was already 0.96. The single miss, "ruj", does not appear in the documents, which say "kozmetik", so keyword search would not have found it either. Hybrid search can be added if Phase 6 shows a need.

## 024: One-shot indexer with content hashes

- **Decision:** A `policy-indexer` compose service runs on every `up`, embeds only new or changed chunks and applies changes in one transaction. Rows from another model count as stale.
- **Alternatives:** Index inside the agent service at startup; index by hand.
- **Why:** `docker compose up` stays a single command, and the free tier is not spent on restarts. Keeping it separate means that the API never starts against an empty index. The cost is that a failed embedding call stops the agent service from starting, which is preferable to answering without policies.

## 025: The UI matches Stitch exactly, with real data in its slots

- **Decision:** Port the Stitch theme and class names unchanged, with the `sohbet_2` colors for every screen. Fields the design shows are backed by real columns where that is cheap (tier, loyalty points, membership, tracking number). Facts the system cannot know, such as a courier plate, show a real value in the same slot (latest shipment event, tracking number). Controls without a backend render as designed but do nothing.
- **Alternatives:** Simplify the design to what the backend supports, which was the first attempt and did not match the design; fill every slot with placeholder data.
- **Why:** The owner requires a 1:1 match. Invented values would still break the rule that order facts come from tools, so the layout is exact while the content stays true. The `sohbet_1` export mixes in brown colors from another theme, so only its layout was used.

## 026: A gated demo login in the order API

- **Decision:** `GET /v1/dev/customers` and `POST /v1/dev/token` exist only with `DEV_LOGIN=true`. The code default is off, and compose turns it on for the demo. Customer rows leave out the phone number.
- **Alternatives:** Hard-code tokens in the frontend; put the signing secret in the browser; issue tokens from the agent service.
- **Why:** The order API already owns customers and token signing. The endpoint can impersonate anyone, so the routes are not registered at all when the flag is off, and a test asserts the resulting 404. The token stays in React memory, not `localStorage`, so a reload logs out; injected script has nothing stored to read.

## 027: One origin through nginx

- **Decision:** The browser calls `/api/agent` and `/api/order`. nginx proxies them in Docker, and Vite does the same in development. Proxy buffering is off for the agent.
- **Alternatives:** CORS on both services.
- **Why:** Same origin needs no CORS configuration on two services. Buffering would hold back the SSE stream and defeat token-by-token display.

## 028: `useReducer` for chat state

- **Decision:** One pure reducer turns SSE events into messages, cards and trace entries. Cards come from `tool_result` data, not from the model's text. Timestamps are passed in with the action.
- **Alternatives:** Redux or Zustand; several `useState` calls.
- **Why:** One screen owns this state, so a store library adds nothing. A pure reducer can be tested with plain event lists. Taking cards from tool results means that a card cannot show something the model made up.
- **Limit:** Trace durations are measured in the browser between `tool_call` and `tool_result`, so they include network time. Token totals arrive with `done`, so a reply that fails midway does not count. Phase 7's Langfuse trace is the accurate source.

## 029: shadcn/ui components, adopted screen by screen

- **Decision:** Add shadcn/ui components to `src/components/ui`, starting with the login cards. Their color names (`card`, `muted-foreground`, `ring` and so on) point at the existing theme tokens.
- **Alternatives:** Keep hand-written Stitch markup; switch to Mantine or Bootstrap.
- **Why:** The hand-written screens did not feel consistent, and every prompt rebuilt elements from scratch. shadcn/ui keeps Tailwind, which the project brief requires, and copies component code into the repository, so it stays editable. `cn` extends tailwind-merge with the custom font sizes; otherwise it reads `text-label-md` as a color and drops the real color class.

## 030: Warm palette, with AI elements and statuses left as they were

- **Decision:** The owner's palette (milk-coffee brown, orange, cream, olive gray) replaces the Stitch blue for surfaces, text, buttons and the customer's messages. AI chat elements, including the composer and its quick replies, keep the Stitch blue through separate `ai` tokens, and status badges keep their colors. The first dark brown primary was replaced by `#8b6a4f` at the owner's request.
- **Alternatives:** The copper theme tried before, which was reverted; one palette for everything.
- **Why:** Requested by the owner, with a lighter background and darker text than first proposed. The palette's hex labels did not match its swatches, so the values were taken from the colors shown. Orange fails contrast as a background for white text, so it is used only for small text and highlights.

## 031: No Agent trace panel in the customer UI

- **Decision:** Remove the Agent trace panel, the "AI Aktif" status pills and the "E-Ticaret Asistanı v2.4" labels from the customer screens.
- **Alternatives:** Keep the trace panel, as the project brief asks for.
- **Why:** The owner's decision. A customer does not need tool calls, and the version label and status pill carried no real information. Tool calls still stream as SSE events and are kept in the chat state, so the admin panel or Langfuse can show them later.

## 032: An orders page with the assistant in a floating window

- **Decision:** The customer screen shows orders with product photos. The assistant opens from a floating button as a window on desktop and full screen on phones. The conversation state lives in the page, so closing the window keeps it.
- **Alternatives:** The chat as the whole page, as before.
- **Why:** Requested by the owner. It matches how stores embed support: the customer looks at orders and asks only when needed. "Asistana sor" on an order prefills its number.

## 033: Product photos from Unsplash, referenced by key

- **Decision:** `order_items.image_key` names each product's photo. `frontend/public/products/manifest.json` maps the key to an Unsplash URL and photographer, filled once by `scripts/fetch-product-images.mjs`. Photos load from Unsplash, and the photographer appears on hover with an Unsplash credit in the footer. Without a photo the card shows an icon.
- **Alternatives:** Download the photos into the repository; store full URLs in the database; Wikimedia Commons; category icons only.
- **Why:** Unsplash's API terms require hotlinking, crediting and reporting each use, which rules out copying files. The search page and unauthenticated endpoints returned 401, so a free API key is needed. Keys keep third-party URLs out of the database and let the photos change without a migration. The key reaches the agent's tool results as well, which lets chat cards show the same photos at the cost of a few tokens.
- **Customer portraits:** `scripts/fetch-customer-photos.mjs` does the same for the ten demo customers, keyed by customer ID in `public/avatars/manifest.json`. Each fictional persona was given a look in that script; the gender-neutral name Deniz got a portrait that does not show one. Results were checked by eye, and children and faceless shots were rejected.

## 034: Dark mode by overriding the same tokens

- **Decision:** A `dark` class on `<html>` redefines the colour variables; components are unchanged. An inline script in `index.html` applies the saved or system theme before the first paint, and the choice is kept in `localStorage`. The pattern has a second, darker tile.
- **Alternatives:** `dark:` variants on every element; following the system setting only.
- **Why:** Every colour already goes through a token, so one block covers the whole UI and the light values stay exactly as the owner set them. Status badges keep their literal colours, which the owner asked to leave unchanged. The theme is a per-visitor convenience, so browser storage fits, wrapped in try/catch for blocked storage.

## 035: A canvas "genie" animation for the assistant window

- **Decision:** On desktop, the assistant window pours into its launcher button when it closes, like the macOS genie effect, and back out when it opens. `genie.ts` draws a snapshot of the window on a canvas in 2px strips, each as wide as a funnel that bends from the window to the button. Snapshots come from `modern-screenshot` 4.7.0 and are taken in the background once the chat has been unchanged for 400ms, so a click starts the animation at once. Mobile keeps its slide, and reduced motion turns the animation off.
- **Alternatives:** CSS scale and opacity, which only resize the window as a whole; `clip-path`, which cut the window instead of bending it; `html-to-image`, which captures scrolled lists from the top and was no faster.
- **Why:** The effect squeezes each row by a different amount, which CSS transforms cannot do on a live element. Taking the snapshot on click cost 0.5–1s, mostly for embedding the fonts, which made the button feel broken.
- **Limit:** A window closed within about half a second of a change waits for a fresh snapshot. The Google Fonts links need `crossorigin` so their rules can be read for embedding.

## 036: Rule-based prompt injection check before the model

- **Decision:** `guardrails/injection.py` normalizes the message (Turkish letters, leetspeak, zero-width characters, letters split by dots) and matches five rule groups: discarding instructions, revealing the prompt, role overrides, jailbreak modes and fake role markers. A blocked message gets a fixed Turkish reply and never reaches the model; the conversation stores a placeholder in its place.
- **Alternatives:** An LLM classifier on every message; relying on the system prompt alone.
- **Why:** No added latency or quota, and each decision can be tested and explained. Verbs match only as imperatives, so "kargo talimatını unuttum" passes. A paraphrase can still get through, which is acceptable because the check is not the security boundary: the model holds no customer identity and the order API checks ownership on every call.

## 037: Personal data masked when a log record is created

- **Decision:** `install_log_masking()` wraps the log record factory, so every record is masked whichever library logs it. TC kimlik numbers and card numbers are masked only when their check digits are valid; phones, IBANs and e-mail addresses by pattern. Handoff summaries go through the same function before they are stored.
- **Alternatives:** A `logging.Filter` on our loggers, which misses uvicorn and httpx; masking at each log call.
- **Why:** One place, nothing to forget. Check digits keep order numbers, prices and tracking codes readable. Tracebacks are not masked, so the service logs exception types only.

## 038: Handoffs decided by rules and stored by the order API

- **Decision:** The graph hands off when the customer asks for a person, when one message is clearly angry or two in a row are irritated, or after three failed turns in a row; the model can also call `escalate_to_human`. The order API stores one handoff per conversation in a `handoffs` table, with the customer taken from the token. Later messages in the conversation get a fixed reply without a model call.
- **Alternatives:** Letting the model decide every handoff; keeping handoffs in the agent's memory.
- **Why:** A rule cannot be talked out of a handoff, and the triggers can be tested. A database row lets the Phase 6 evaluation check that a handoff really happened. A failed turn is a tool error, an empty policy search, a blocked message, an empty reply or the step limit; answers such as "the return window has passed" are not failures. A helpful turn resets the count.
- **Limit:** Frustration is a word list. It misses sarcasm and unusual phrasing, which the evaluation scenarios will measure.

## 039: Invented order numbers are flagged after the reply, not blocked

- **Decision:** After each reply, order numbers and tracking codes that no tool result and no customer message contained are reported as a `grounding_violation` event, logged, and counted as a failed turn.
- **Alternatives:** Buffering the reply and checking it before it is shown.
- **Why:** Buffering would end token streaming. The system prompt already forbids invented data, so this check measures how often the rule is broken and pushes a repeat offender towards a handoff. The Phase 6 judge covers invented facts that are not numbers.

## 040: Evaluation reuses the agent service's environment and LLM client

- **Decision:** `evals/` has no dependency list of its own. It runs with `uv run --project agent-service` and imports the agent's `LLMClient`, Gemini/Ollama clients, SSE reader and dev token helper.
- **Alternatives:** A separate package with its own lock file and model client; packaging the agent service so that `evals` can depend on it.
- **Why:** One provider interface, as the project requires, and one set of pinned versions. The cost is one explicit `sys.path` line in `evals/__init__.py`.

## 041: Scenarios in JSON, checked against the seed by tests

- **Decision:** 56 scenarios in one JSON file per category, 16 of them adversarial. Each states its tools (required, one-of, forbidden), whether the injection check must fire, the expected handoff, the one order that may get a return, and text that must never appear. A strict schema rejects unknown keys. Tests check every scenario against the seed data and the guardrail rules, so a scenario cannot expect something impossible.
- **Alternatives:** Scenarios in Python; free-text expectations left to the judge.
- **Why:** Data that a reviewer can read without the code. Anything that can be checked from events or the database is checked there, and the judge only scores what needs reading.

## 042: Success needs both the deterministic checks and the judge

- **Decision:** A scenario succeeds only if every deterministic check passes and the judge says the task succeeded. The database, reset to the seed before each scenario, decides whether a return or handoff happened, not the agent's words. Hallucination and policy compliance are reported separately from success.
- **Alternatives:** Judge only; checks only.
- **Why:** The judge can be fooled by a confident reply and the checks cannot read tone or correctness of an explanation. Requiring both makes a pass harder to fake.

## 043: Simulator and judge on other models, with patient retries and resumable runs

- **Decision:** `SIMULATOR_MODEL` (gemini-3.5-flash-lite) and `JUDGE_MODEL` (gemini-3.5-flash) are set apart from the agent's model. Their clients retry up to five times and wait up to a minute; the agent keeps its quick two retries. Results are appended per scenario to `reports/runs/<id>.jsonl`, and `--resume` skips finished scenarios. `--subset N` is deterministic and starts with the adversarial categories.
- **Alternatives:** Everything on the agent's model; several API keys.
- **Why:** Free-tier quotas are per model and per minute. A judge from another model also avoids a model grading its own replies. Newer models (3.7, 3.8) were not usable on the free tier when this was set up.

## 044: The admin panel reads the latest report file

- **Decision:** nginx serves `evals/reports/latest.json`, mounted read-only into the frontend container, at `/reports/latest.json`; Vite serves the same file in development. The panel and the replay view are hash routes (`#/admin`, `#/admin/<scenario>`). Only a finished run replaces `latest.json`, and each run records the models it uses, so a resumed run or a rebuilt report keeps them.
- **Alternatives:** An API endpoint in the agent or order service; a router library; building the report into the image.
- **Why:** The report is a static file the evaluation already writes, so a new run appears without a rebuild or a new endpoint. Three screens do not need a router, and a hash survives a reload behind nginx's single `index.html`. The panel is open until Phase 7's admin login; the report holds only seed data. `@types/node` 22.20.5 is added for the Vite config's file read, as a type-only dev dependency.

## 045: The full evaluation is spread over several days

- **Decision:** The free tier allows 20 generate requests per model per day (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`), read from the 429 response. A full run of 56 scenarios needs about 150-170 agent calls, so it runs as one run resumed daily with `--resume`, after the quota resets at midnight Pacific time. The runner waits out an agent 429 twice, restarting the scenario from a fresh conversation, before it stops. The 5-scenario subset fits in a day and is what CI will run.
- **Alternatives:** Ollama for the simulator and judge (checked: no discrete GPU and 11 GB of free disk on the development machine, so slow and a weaker Turkish judge); a weaker agent model with a larger quota, which would measure a different agent; paid tier.
- **Why:** It keeps the agent, simulator and judge models the run was designed for, and costs nothing but time. Results are appended per scenario, so a stop loses nothing.

## 046: Email and password login with bcrypt and a role claim

- **Decision:**
  - **Passwords:** bcrypt with cost 12 (`golang.org/x/crypto` v0.58.0), for customers and a new `admins` table.
  - **Tokens:** they carry a `role` claim, `customer` or `admin`, and order routes accept only customer tokens.
  - **Failed logins:** an unknown email and a wrong password get the same answer, and an unknown email is still compared against a fixed dummy hash so that the response time does not reveal it.
  - **Rate limit:** five failures per email and per client address in 15 minutes return 429. The limit is kept in memory, and the client address comes from nginx's `X-Real-IP`, trusted because the service is bound to localhost.
- **Alternatives:** argon2id; a rate limit in Redis; trusting any `X-Forwarded-For`.
- **Why:** bcrypt is in Go's extended standard library and is enough here. One instance needs no shared store. The session is stored in the request context as a typed value; replacing the plain customer ID showed why: the old `.(string)` assertion would have compiled and then panicked on every request, which is what the role tests now cover.

## 047: Admins view a customer through a read-only token

- **Decision:** An admin token cannot read orders. To open a customer, the admin asks for a 15-minute customer token with `readonly: true` and `act: {sub: admin}` (RFC 8693), and every such view writes an audit row. Middleware refuses every non-GET request in a read-only session. The agent accepts that token, does not offer `create_return_request` or `escalate_to_human`, refuses them if called anyway, answers a request for a person with an explanation instead of a handoff, and keeps the admin's conversations in their own threads.
- **Alternatives:** Letting admin tokens read any customer's orders; hiding buttons in the UI only.
- **Why:** The subject stays the customer, so every existing ownership check applies unchanged, and the token says who is looking. Enforcement on the server covers routes added later; the UI only reflects it.

## 048: The evaluation report sits behind an admin check in nginx

- **Decision:** `/reports/latest.json` uses nginx's `auth_request` against the order API's `GET /v1/admin/me`; the panel sends the admin token, and the Vite dev server performs the same check. The download link is built from the report already in memory, since a link cannot send a header.
- **Alternatives:** Serving the report from an API endpoint; hiding the page only.
- **Why:** The file stays a static file the evaluation writes, and access is decided by the same service that issues admin tokens.

## 049: Traces in the project's Postgres, Langfuse optional

- **Decision:** Every answered message is written to an `agent_traces` table with latency, time to first token, tokens, cost, tools and outcome, texts masked. The agent's role may insert there and nothing else. With `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` set, traces are also sent to Langfuse's public ingestion API through `httpx`; without them nothing leaves the machine. A failed write is logged and never breaks the chat.
- **Alternatives:** Langfuse Cloud by default; self-hosted Langfuse v3 (Postgres, ClickHouse, Redis and MinIO).
- **Why:** The brief names Langfuse, but the owner asked that no data leave the machine and that the laptop not run another heavy stack. Postgres already runs, and the HTTP API keeps the Langfuse path without an SDK dependency.

## 050: The evaluation in CI runs on demand

- **Decision:** Every pull request runs lint and unit tests for the three services. The 5-scenario evaluation starts the whole stack with compose and runs only for the `run-evals` label or a manual run, using the `GEMINI_API_KEY` repository secret, and uploads the report as an artifact.
- **Alternatives:** Running it on every pull request, as the brief says; recorded model replies.
- **Why:** The free tier allows 20 requests per model a day and one run uses about 15, so an automatic run on every push would starve the evaluation itself. The label keeps it one click away.

## 051: Ed25519 token signing; only the order API can sign

- **Decision:** Session tokens are signed with Ed25519 (`EdDSA`) instead of a shared HS256 secret. The order API holds the private key and the agent service only the public key, both mounted as compose secrets from a git-ignored `secrets/` folder made by `make keys` (or `cmd/keygen`). The agent's token-minting helper is gone: the CLI and the evaluation get demo tokens from the order API's `/v1/dev/token`, and agent tests sign with a key pair made per test run.
- **Alternatives:** Keep HS256 with one secret in both services; RS256; fetching the public key from a JWKS endpoint.
- **Why:** With a shared secret, a compromised agent could mint any token, an admin's included. Now the one service that issues identities is the only one able to. Ed25519 has small keys and fast, deterministic signatures, and both `golang-jwt` and PyJWT support it. Verification pins the algorithm, and tests show that a token from another key and an HS256 token keyed with the public key are both refused. Rotation means a new key pair and a restart, which signs everyone out; a `kid` header and a JWKS endpoint would allow overlap, not needed for one deployment.

## 052: Conversation memory in Postgres

- **Decision:** The agent checkpoints conversations with LangGraph's Postgres saver (`langgraph-checkpoint-postgres` 3.2.0, `psycopg` 3.3.6, `psycopg-pool` 3.3.3) into an `agent_memory` schema owned by the agent's role (migration 00008). Tests without a database keep the in-memory saver. The saver is created at startup, since it binds to the running event loop, and startup fails within 10 seconds if the database cannot be reached.
- **Alternatives:** The in-memory saver; Redis; storing transcripts in our own table.
- **Why:** Memory survives restarts and can be shared by several instances, which a test checks by answering one conversation from two app instances, and a live check confirmed for a handed-off conversation across `docker compose restart agent-service`. The official saver handles serialization and its own schema migrations. A schema of its own lets it create tables without any right on customer data. Messages are stored as the model sees them, not masked; old conversations are not cleaned up yet.
- **Note:** On Windows, psycopg's async mode needs a selector event loop, which the tests set through pytest-asyncio's loop factory hook, and `localhost` must be written as `127.0.0.1`: the pool's connection over `::1` stalls in Docker Desktop's port forwarding.

## 053: A per-account limit on chat messages

- **Decision:** The chat endpoint allows each account 20 messages a minute and 300 a day, by default, and answers 429 with `Retry-After` beyond that; the UI says to wait a minute. An admin's view counts against the admin, not the customer viewed. The windows live in process memory.
- **Alternatives:** A limit per IP in nginx; no limit.
- **Why:** Logins were limited but a signed-in account could still send hundreds of messages and spend the whole model quota or budget. Counting per account follows the identity the token already proves. One instance needs no shared store; several would need Redis.

## 054: Personal data masked before it is stored, and deleted on a schedule

- **Decision:** A customer's message is masked (TC kimlik, card, phone, IBAN, e-mail) before it joins the conversation, so the stored memory and the model provider see only placeholders; the guardrails still read the original. The agent deletes conversations whose last step is older than 30 days, every six hours. The order API deletes traces older than 30 days and audit rows older than 365 days on the same schedule. All periods are settings.
- **Alternatives:** Masking only logs, as before; encrypting messages at rest.
- **Why:** No tool needs these numbers, so keeping them only adds risk, and not sending them to an external model is the stronger guarantee. Fixed retention is what KVKK expects of data kept for a purpose. Audit rows are kept longer because they answer who looked at a customer's data.

## 055: Security headers with a hash-pinned CSP

- **Decision:** nginx sends a Content-Security-Policy that allows scripts only from the site plus the inline theme script by its SHA-256, styles from the site and Google Fonts, images from the site and Unsplash, and no framing; along with `nosniff`, `X-Frame-Options: DENY`, a referrer policy and a permissions policy. The headers live in one file included wherever a location sets its own headers. `.gitattributes` pins `index.html` to LF, and a test checks that the hash in the config matches the script.
- **Alternatives:** `'unsafe-inline'` for scripts; moving the theme script to a file.
- **Why:** The CSP limits what an injected script could do. The inline script must run before the first paint, so it stays inline and is allowed by hash. Its hash covers exact bytes, and Git would check the file out with CRLF on Windows and LF elsewhere, so the line endings are fixed. nginx drops inherited `add_header` lines in a location that has its own, which would have left the report without headers.

