"""Embedding providers. Documents and queries are embedded differently on purpose: both
models are trained to match a short query against a longer passage."""

import asyncio
import logging
import random
from typing import Protocol

import httpx
from google import genai
from google.genai import errors, types

from app.config import Settings

logger = logging.getLogger(__name__)

# Must match the vector column in order-api/migrations/00002_policy_chunks.sql.
EMBEDDING_DIMENSIONS = 768

RETRYABLE_STATUS = {429, 503, 504}
MAX_ATTEMPTS = 3
BATCH_SIZE = 50
REQUEST_TIMEOUT_MS = 15_000


class EmbeddingClient(Protocol):
    model: str

    async def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    async def embed_query(self, text: str) -> list[float]: ...


class GeminiEmbeddings:
    def __init__(self, api_key: str, model: str) -> None:
        self._client = genai.Client(
            api_key=api_key, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS)
        )
        self.model = model

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), BATCH_SIZE):
            batch = texts[start : start + BATCH_SIZE]
            vectors.extend(await self._embed(batch, "RETRIEVAL_DOCUMENT"))
        return vectors

    async def embed_query(self, text: str) -> list[float]:
        return (await self._embed([text], "RETRIEVAL_QUERY"))[0]

    async def _embed(self, texts: list[str], task_type: str) -> list[list[float]]:
        config = types.EmbedContentConfig(
            task_type=task_type, output_dimensionality=EMBEDDING_DIMENSIONS
        )
        for attempt in range(MAX_ATTEMPTS):
            try:
                response = await self._client.aio.models.embed_content(
                    model=self.model, contents=texts, config=config
                )
                return [embedding.values for embedding in response.embeddings]
            except (errors.APIError, httpx.TimeoutException) as exc:
                code = getattr(exc, "code", 504)
                if code not in RETRYABLE_STATUS or attempt == MAX_ATTEMPTS - 1:
                    raise
                delay = 2**attempt * random.uniform(0.5, 1.0)
                logger.warning("embedding retry %d in %.1fs", attempt + 1, delay)
                await asyncio.sleep(delay)
        raise AssertionError("unreachable")


class LocalE5Embeddings:
    """multilingual-e5 expects "passage: " and "query: " prefixes on its input."""

    def __init__(self, model: str) -> None:
        # Imported here because it pulls in torch, which the default image does not have.
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(model)
        self.model = model

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return await self._encode([f"passage: {text}" for text in texts])

    async def embed_query(self, text: str) -> list[float]:
        return (await self._encode([f"query: {text}"]))[0]

    async def _encode(self, texts: list[str]) -> list[list[float]]:
        # Encoding is CPU work and would otherwise block the event loop.
        vectors = await asyncio.to_thread(self._model.encode, texts, normalize_embeddings=True)
        return vectors.tolist()


def build_embedding_client(settings: Settings) -> EmbeddingClient:
    if settings.embedding_provider == "gemini":
        return GeminiEmbeddings(
            settings.gemini_api_key.get_secret_value(), settings.embedding_model
        )
    return LocalE5Embeddings(settings.embedding_model)
