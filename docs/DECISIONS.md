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
