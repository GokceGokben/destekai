-- +goose Up
-- One row per customer message the agent answered: latency, tokens, cost, tools and outcome.
-- Message texts are masked before they are written.
CREATE TABLE agent_traces (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    customer_id     TEXT NOT NULL,
    read_only       BOOLEAN NOT NULL DEFAULT false,
    model           TEXT NOT NULL,
    outcome         TEXT NOT NULL CHECK (outcome IN ('answered', 'blocked', 'handoff', 'error')),
    started_at      TIMESTAMPTZ NOT NULL,
    latency_ms      INTEGER NOT NULL,
    first_token_ms  INTEGER,
    input_tokens    INTEGER NOT NULL,
    output_tokens   INTEGER NOT NULL,
    cost_usd        NUMERIC(12, 6),
    tools           JSONB NOT NULL,
    customer_text   TEXT NOT NULL,
    reply_text      TEXT NOT NULL
);

CREATE INDEX agent_traces_started_at_idx ON agent_traces (started_at DESC);

-- The agent writes traces and nothing else here; it cannot read them back or change them.
GRANT INSERT ON agent_traces TO destekai_agent;

-- +goose Down
REVOKE ALL ON agent_traces FROM destekai_agent;
DROP TABLE agent_traces;
