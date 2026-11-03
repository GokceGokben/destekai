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
