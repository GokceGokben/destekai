-- +goose Up
-- The agent's conversation memory (LangGraph checkpoints). The agent's role owns this schema,
-- so the checkpointer can create and migrate its own tables here, and nowhere else: it still
-- has no rights on customer tables.
CREATE SCHEMA IF NOT EXISTS agent_memory AUTHORIZATION destekai_agent;

-- +goose Down
DROP SCHEMA agent_memory CASCADE;
