"""Brings the policy index up to date.

Usage: python -m app.rag.index

Idempotent: unchanged chunks are not embedded again, so a restart spends no quota.
"""

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path

from app.config import Settings
from app.rag.chunking import Chunk, chunk_document
from app.rag.embeddings import EmbeddingClient, build_embedding_client
from app.rag.store import PolicyStore, StoredChunk


@dataclass(frozen=True)
class IndexPlan:
    new_chunks: list[Chunk]
    stale_ids: list[int]


def load_chunks(directory: Path) -> list[Chunk]:
    chunks = [
        chunk
        for path in sorted(directory.glob("*.md"))
        for chunk in chunk_document(path.stem, path.read_text(encoding="utf-8"))
    ]
    # Refusing to continue protects the index: no input would otherwise mean "delete it all".
    if not chunks:
        raise SystemExit(f"no policy documents found in {directory}")
    return chunks


def plan_index(chunks: list[Chunk], stored: list[StoredChunk], model: str) -> IndexPlan:
    """Rows from another embedding model count as stale, so changing the model re-indexes."""
    wanted = {(chunk.document, chunk.content_hash) for chunk in chunks}
    current = {(row.document, row.content_hash) for row in stored if row.embedding_model == model}
    return IndexPlan(
        new_chunks=[c for c in chunks if (c.document, c.content_hash) not in current],
        stale_ids=[
            row.id
            for row in stored
            if row.embedding_model != model or (row.document, row.content_hash) not in wanted
        ],
    )


async def run_index(
    store: PolicyStore, embedder: EmbeddingClient, chunks: list[Chunk]
) -> IndexPlan:
    plan = plan_index(chunks, await store.list_chunks(), embedder.model)
    embeddings = []
    if plan.new_chunks:
        embeddings = await embedder.embed_documents([c.content for c in plan.new_chunks])
    if plan.new_chunks or plan.stale_ids:
        await store.apply_changes(plan.stale_ids, plan.new_chunks, embeddings, embedder.model)
    return plan


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = Settings()
    store = PolicyStore(settings.database_url.get_secret_value())
    await store.connect()
    try:
        chunks = load_chunks(Path(settings.policy_dir))
        plan = await run_index(store, build_embedding_client(settings), chunks)
        print(
            f"policy index: {len(chunks)} chunks, {len(plan.new_chunks)} embedded, "
            f"{len(plan.stale_ids)} removed"
        )
    finally:
        await store.close()


if __name__ == "__main__":
    asyncio.run(main())
