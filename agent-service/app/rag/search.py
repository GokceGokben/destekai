import logging
from typing import Any

from app.rag.embeddings import EmbeddingClient
from app.rag.store import PolicyStore

logger = logging.getLogger(__name__)

TOP_K = 4
# From app.rag.evaluate with gemini-embedding-001: the weakest expected match scores 0.69,
# and six of seven out-of-scope questions score at most 0.64. Re-measure if the model changes.
MIN_SIMILARITY = 0.65


class PolicySearchError(Exception):
    pass


class PolicySearch:
    def __init__(
        self,
        embedder: EmbeddingClient,
        store: PolicyStore,
        min_similarity: float = MIN_SIMILARITY,
    ) -> None:
        self._embedder = embedder
        self._store = store
        self._min_similarity = min_similarity

    async def connect(self) -> None:
        await self._store.connect()

    async def close(self) -> None:
        await self._store.close()

    async def search(self, query: str, limit: int = TOP_K) -> list[dict[str, Any]]:
        """Weak matches are dropped: returning nothing makes the agent say it does not know,
        while returning the nearest unrelated text invites it to answer from that."""
        try:
            embedding = await self._embedder.embed_query(query)
            hits = await self._store.search(embedding, self._embedder.model, limit)
        except Exception as exc:
            # Only the type: the query is customer text.
            logger.error("policy search failed: %s", type(exc).__name__)
            raise PolicySearchError from exc

        return [
            {
                "document": hit.document,
                "section": hit.section,
                "content": hit.content,
                "similarity": round(hit.similarity, 3),
            }
            for hit in hits
            if hit.similarity >= self._min_similarity
        ]
