-- +goose Up
-- A conversation handed to a human agent. One per conversation: the agent may ask twice,
-- and the evaluation checks this table to see whether a handoff really happened.
CREATE TABLE handoffs (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id     TEXT NOT NULL REFERENCES customers (id),
    conversation_id TEXT NOT NULL CHECK (conversation_id ~ '^[A-Za-z0-9-]{1,64}$'),
    reason          TEXT NOT NULL CHECK (reason IN ('customer_request', 'repeated_failures', 'frustration', 'agent_decision')),
    summary         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, conversation_id)
);

-- +goose Down
DROP TABLE handoffs;
