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
