-- +goose Up
-- 768 dimensions: gemini embeddings can be reduced to it, multilingual-e5-base
-- produces it natively, and HNSW on the vector type stops at 2000.
CREATE TABLE policy_chunks (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document        TEXT NOT NULL,
    section         TEXT NOT NULL,
    content         TEXT NOT NULL,
    content_hash    TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    embedding       vector(768) NOT NULL,
    UNIQUE (document, content_hash, embedding_model)
);

CREATE INDEX policy_chunks_embedding_idx ON policy_chunks USING hnsw (embedding vector_cosine_ops);

-- The agent service reaches the database only through this role. It has no rights
-- on customer tables, so a compromised agent still goes through the order API.
-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'destekai_agent') THEN
        CREATE ROLE destekai_agent LOGIN;
    END IF;
END
$$;
-- +goose StatementEnd

GRANT SELECT, INSERT, DELETE ON policy_chunks TO destekai_agent;
GRANT USAGE ON SEQUENCE policy_chunks_id_seq TO destekai_agent;

-- +goose Down
REVOKE ALL ON policy_chunks FROM destekai_agent;
DROP TABLE policy_chunks;
-- The role is cluster-wide and may still be used by another database.
