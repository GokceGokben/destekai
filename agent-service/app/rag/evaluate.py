"""Measures retrieval on its own, without the model answering on top of it.

Usage: python -m app.rag.evaluate [--file /evals/questions.json]

Questions with an empty "expected" list are out of scope. Their similarity scores show
where MIN_SIMILARITY must sit to reject them without losing the real matches.
"""

import argparse
import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from statistics import mean

from app.config import Settings
from app.rag.embeddings import build_embedding_client
from app.rag.search import TOP_K
from app.rag.store import PolicyHit, PolicyStore


@dataclass(frozen=True)
class Result:
    question: str
    rank: int | None  # 1-based rank of the first expected section
    top_similarity: float
    expected_similarity: float | None


def first_match(hits: list[PolicyHit], expected: list[list[str]]) -> int | None:
    wanted = {tuple(item) for item in expected}
    for rank, hit in enumerate(hits, start=1):
        if (hit.document, hit.section) in wanted:
            return rank
    return None


def summarize(in_scope: list[Result], out_of_scope: list[Result]) -> dict[str, float]:
    return {
        f"recall@{TOP_K}": mean(result.rank is not None for result in in_scope),
        "mrr": mean(1 / result.rank if result.rank else 0 for result in in_scope),
        "lowest_expected_similarity": min(
            result.expected_similarity
            for result in in_scope
            if result.expected_similarity is not None
        ),
        "highest_out_of_scope_similarity": max(
            (result.top_similarity for result in out_of_scope), default=0.0
        ),
    }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default="/evals/questions.json")
    args = parser.parse_args()

    settings = Settings()
    embedder = build_embedding_client(settings)
    store = PolicyStore(settings.database_url.get_secret_value())
    await store.connect()

    in_scope: list[Result] = []
    out_of_scope: list[Result] = []
    try:
        for item in json.loads(Path(args.file).read_text(encoding="utf-8")):
            embedding = await embedder.embed_query(item["question"])
            hits = await store.search(embedding, embedder.model, TOP_K)
            if not hits:
                raise SystemExit(f"the index has no chunks for {embedder.model}")
            rank = first_match(hits, item["expected"])
            result = Result(
                question=item["question"],
                rank=rank,
                top_similarity=hits[0].similarity,
                expected_similarity=hits[rank - 1].similarity if rank else None,
            )
            (in_scope if item["expected"] else out_of_scope).append(result)
    finally:
        await store.close()

    for result in in_scope:
        if result.rank != 1:
            print(f"rank={result.rank} top={result.top_similarity:.3f} {result.question}")
    for result in out_of_scope:
        print(f"out of scope top={result.top_similarity:.3f} {result.question}")
    print(json.dumps({"model": embedder.model, **summarize(in_scope, out_of_scope)}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
