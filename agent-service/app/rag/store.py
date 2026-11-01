from dataclasses import dataclass

import asyncpg
from pgvector.asyncpg import register_vector

from app.rag.chunking import Chunk


@dataclass(frozen=True)
class PolicyHit:
    document: str
    section: str
    content: str
    similarity: float


@dataclass(frozen=True)
class StoredChunk:
    id: int
    document: str
    content_hash: str
    embedding_model: str


class PolicyStore:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        self._pool = await asyncpg.create_pool(
            self._dsn, min_size=1, max_size=5, init=register_vector
        )

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

    async def search(self, embedding: list[float], model: str, limit: int) -> list[PolicyHit]:
        # Vectors from another model live in a different space and must not be compared.
        rows = await self._pool.fetch(
            """
            SELECT document, section, content, 1 - (embedding <=> $1) AS similarity
            FROM policy_chunks
            WHERE embedding_model = $2
            ORDER BY embedding <=> $1
            LIMIT $3
            """,
            embedding,
            model,
            limit,
        )
        return [PolicyHit(**dict(row)) for row in rows]

    async def list_chunks(self) -> list[StoredChunk]:
        rows = await self._pool.fetch(
            "SELECT id, document, content_hash, embedding_model FROM policy_chunks"
        )
        return [StoredChunk(**dict(row)) for row in rows]

    async def apply_changes(
        self,
        stale_ids: list[int],
        new_chunks: list[Chunk],
        embeddings: list[list[float]],
        model: str,
    ) -> None:
        """All or nothing: search never sees a half-updated index."""
        async with self._pool.acquire() as connection, connection.transaction():
            await connection.execute("DELETE FROM policy_chunks WHERE id = ANY($1)", stale_ids)
            await connection.executemany(
                """
                INSERT INTO policy_chunks
                    (document, section, content, content_hash, embedding_model, embedding)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                [
                    (c.document, c.section, c.content, c.content_hash, model, embedding)
                    for c, embedding in zip(new_chunks, embeddings, strict=True)
                ],
            )
