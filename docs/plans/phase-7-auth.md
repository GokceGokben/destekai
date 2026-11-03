# Phase 7 addition: real login and a read-only admin view

Agreed with the project owner on 2026-11-03, to be built in Phase 7. Until then the demo
login (`DEV_LOGIN`, decision 026) stays the only way in.

## Why it was deferred

- The brief asks for a mock JWT: the customer ID comes from the session, never from the LLM.
  Authentication is not what the project is about; the agent, RAG, guardrails and evals are.
- The isolation that matters does not depend on how a token is issued. The order API checks
  on every request that the order belongs to the token's customer, and the agent forwards the
  customer's own token. That holds for a password login and for the demo login alike.
- Phase 6's customer simulator has to act as any customer. The demo login makes that simple.
- A half-built login (plain-text passwords, no rate limit) would hurt more than it helps.

## Goals

1. Customers sign in with email and password and see only their own panel.
2. An admin signs in with email and password and sees every customer, like the
   "Demo Müşteri Seç" screen today.
3. When an admin opens a customer, the panel is read-only. This is enforced on the server,
   not only by hiding buttons.

## Data model (order-api migration)

- `customers.password_hash TEXT NOT NULL` (bcrypt).
- New table `admins`: `id TEXT PRIMARY KEY` (`ADM-1001` style), `full_name`, `email UNIQUE`,
  `password_hash`, `created_at`.
- New table `admin_audit_log`: `id`, `admin_id`, `customer_id`, `action` (`view_customer`,
  `chat_as_viewer`), `created_at`. Every admin look at a customer is recorded.
- Seed: one hash per demo account, computed once and stored in `seed.sql`. Never plain text.
  Demo passwords are documented in the README so a reviewer can sign in.
  - Customers: `ayse.yilmaz@example.com` and the other nine, one shared demo password.
  - Admin: `admin@destekai.local` with its own demo password.

## Tokens

All tokens stay HS256 JWTs signed with `JWT_SECRET`, issuer `destekai`.

| Token | `sub` | `role` | Extra claims | Lifetime |
| --- | --- | --- | --- | --- |
| Customer | customer ID | `customer` | none | 8 hours |
| Admin | admin ID | `admin` | none | 8 hours |
| Admin viewing a customer | customer ID | `customer` | `act: {sub: admin ID}`, `readonly: true` | 15 minutes |

- The view token follows RFC 8693's `act` claim: the subject stays the customer, so every
  existing ownership check works unchanged, and the actor records who is looking.
- An admin token alone cannot read orders: order routes need `role: customer`. The admin
  gets a short view token per customer instead, so every view is explicit and logged.
- Tokens live in React memory only, as today.

## Order API

- `POST /v1/auth/login` `{email, password}` → `{token, customer}`.
- `POST /v1/admin/login` `{email, password}` → `{token, admin}`.
- `GET /v1/admin/customers` (admin token): the same data as `/v1/dev/customers`, phone
  number still left out.
- `POST /v1/admin/customers/{id}/view-token` (admin token) → read-only customer token. Writes
  an audit row.
- Read-only enforcement: middleware rejects every non-GET request that carries
  `readonly: true` with `403 read_only_session`. Today that covers `POST /returns`; any write
  route added later is covered by default.
- Login hardening:
  - bcrypt with cost 12 (`golang.org/x/crypto/bcrypt`, version pinned when added).
  - The same error for an unknown email and a wrong password (`invalid_credentials`).
  - When the email is unknown, still compare against a fixed dummy hash, so the response time
    does not reveal which emails exist.
  - Rate limit: 5 failed attempts per email and per IP in 15 minutes, then `429`. In memory,
    which suits the single instance; a shared store (Redis) would be needed for several.
  - Emails compared case-insensitively.
- `DEV_LOGIN` remains, default off in code and on in compose, for the evals and quick demos.

## Agent service

- `verify_token` returns the customer ID and a `readonly` flag.
- In a read-only session the model is not offered `create_return_request`, and
  `execute_tool` refuses it if called anyway (`read_only_session`). The order API would also
  refuse; this is defence in depth.
- The system prompt gets one line for read-only sessions: an admin is viewing; explain that
  actions cannot be taken from this view.
- Read-only conversations use a separate thread ID prefix (`view:{admin}:{customer}:{id}`), so
  an admin never sees or continues the customer's own conversation memory.

## Frontend

- Login screen with two tabs: "Müşteri Girişi" and "Yönetici Girişi". Email and password
  fields, Turkish error messages, the submit button disabled while waiting.
- Admin home: the customer cards of today's demo screen, fed by `/v1/admin/customers`.
- Opening a customer requests a view token and shows that customer's panel with:
  - A fixed banner: "Yönetici görünümü: {ad} — salt okunur".
  - "Asistana sor", quick replies and the chat stay usable for questions; return actions in
    cards are hidden.
  - A "Müşteri listesine dön" button. The view token expires after 15 minutes; on 401 the UI
    returns to the list.
- The demo picker stays reachable only when `DEV_LOGIN` is on, labelled as demo.
- The header shows who is signed in: the customer's name, or the admin's name with "Yönetici".

## Out of scope

Password reset, email verification, multi-factor login, account lockout beyond the rate limit,
refresh tokens, and admin roles beyond read-only viewing. The README lists them as known gaps.

## Tests

- Go: login success; wrong password and unknown email give identical responses; rate limit
  returns 429 after 5 failures; an admin token cannot read orders; a view token can read the
  customer's orders but `POST /returns` gets 403; a view token cannot read another customer;
  each view token writes one audit row.
- Python: read-only sessions are not offered `create_return_request`; a forced call is
  refused; read-only threads are separate from the customer's thread.
- Frontend: both login forms; admin list opens a read-only panel with its banner; return
  actions are hidden in read-only mode; a 401 returns to the right screen.

## Decisions to record in docs/DECISIONS.md when built

- bcrypt over argon2 (standard library support in Go, enough for a demo) or the reverse, once
  chosen.
- The `act` claim for admin views instead of letting admin tokens read orders directly.
- Server-side read-only enforcement in middleware.
- In-memory rate limiting and its single-instance limit.
