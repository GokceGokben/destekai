import os
from pathlib import Path

import asyncpg
import pytest

from app.prompts import build_system_prompt
from app.rag.chunking import Chunk, chunk_document, split_long
from app.rag.index import load_chunks, plan_index, run_index
from app.rag.search import PolicySearch, PolicySearchError
from app.rag.store import PolicyHit, PolicyStore, StoredChunk
from app.tools import TOOLS
from tests.conftest import FakeLLM, FakePolicySearch, parse_sse, text, tool

POLICY_DIR = Path(__file__).parents[2] / "docs" / "policies"
AGENT_DB_URL = os.environ.get("AGENT_TEST_DATABASE_URL")


def stored(row_id: int, chunk: Chunk, model: str = "m1") -> StoredChunk:
    return StoredChunk(row_id, chunk.document, chunk.content_hash, model)


class FakeEmbedder:
    model = "m1"

    def __init__(self) -> None:
        self.embedded: list[str] = []

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        self.embedded.extend(texts)
        return [[1.0] + [0.0] * 767 for _ in texts]

    async def embed_query(self, text: str) -> list[float]:
        return [1.0] + [0.0] * 767


def test_chunks_follow_headings_and_carry_their_context():
    markdown = "# İade\n\nGiriş\n\n## Süre\n\n14 gün.\n\n## Şartlar\n\nAmbalajlı olmalı.\n"
    chunks = chunk_document("iade", markdown)

    assert [chunk.section for chunk in chunks] == ["Süre", "Şartlar"]
    assert chunks[0].document == "iade"
    assert chunks[0].content == "İade - Süre\n\n14 gün."


def test_short_section_stays_whole():
    assert split_long("kısa metin") == ["kısa metin"]


def test_long_section_splits_at_paragraphs_with_overlap():
    paragraphs = [f"paragraf {i} " + "x" * 500 for i in range(4)]
    parts = split_long("\n\n".join(paragraphs))

    assert len(parts) > 1
    assert all(len(part) <= 1100 for part in parts)
    assert parts[0].split("\n\n")[-1] == parts[1].split("\n\n")[0]
    for paragraph in paragraphs:
        assert any(paragraph in part for part in parts)


def test_real_policies_produce_clean_chunks():
    chunks = load_chunks(POLICY_DIR)

    assert {chunk.document for chunk in chunks} == {"iade", "kargo", "garanti", "odeme"}
    assert len({(chunk.document, chunk.content_hash) for chunk in chunks}) == len(chunks)
    assert all(chunk.content.strip() for chunk in chunks)


def test_load_chunks_refuses_an_empty_directory(tmp_path):
    with pytest.raises(SystemExit):
        load_chunks(tmp_path)


def test_plan_skips_unchanged_and_removes_stale():
    keep = Chunk("iade", "A", "aynı")
    new = Chunk("iade", "B", "yeni")
    gone = Chunk("iade", "C", "silindi")

    plan = plan_index([keep, new], [stored(1, keep), stored(2, gone)], "m1")

    assert plan.new_chunks == [new]
    assert plan.stale_ids == [2]


def test_changing_the_model_reindexes_everything():
    chunk = Chunk("iade", "A", "aynı")
    plan = plan_index([chunk], [stored(1, chunk, model="old")], "m1")

    assert plan.new_chunks == [chunk]
    assert plan.stale_ids == [1]


class StubStore:
    def __init__(self, hits=None, error=None) -> None:
        self.hits = hits or []
        self.error = error

    async def search(self, embedding, model, limit):
        if self.error:
            raise self.error
        return self.hits


async def test_weak_matches_are_dropped():
    hits = [PolicyHit("iade", "A", "yakın", 0.8), PolicyHit("kargo", "B", "uzak", 0.2)]
    search = PolicySearch(FakeEmbedder(), StubStore(hits), min_similarity=0.5)

    results = await search.search("iade süresi")

    assert [result["section"] for result in results] == ["A"]


async def test_search_failure_is_wrapped():
    search = PolicySearch(FakeEmbedder(), StubStore(error=ConnectionError("db down")))
    with pytest.raises(PolicySearchError):
        await search.search("iade")


async def test_search_policy_result_reaches_the_model(harness):
    hit = {"document": "iade", "section": "İade süresi", "content": "14 gün", "similarity": 0.8}
    policy = FakePolicySearch([hit])
    h = harness(FakeLLM(tool("search_policy", {"query": "iade süresi"}), text("14 gün.")), policy)

    events = parse_sse(await h.post("Kaç gün içinde iade edebilirim?"))

    assert policy.queries == ["iade süresi"]
    assert events[1][1]["result"] == {"results": [hit]}
    assert "14 gün" in h.llm.calls[1]["messages"][-1]["content"]


async def test_search_failure_becomes_a_tool_error(harness):
    policy = FakePolicySearch()
    policy.results = PolicySearchError()
    h = harness(FakeLLM(tool("search_policy", {"query": "iade"}), text("Ulaşılamıyor.")), policy)

    events = parse_sse(await h.post("İade?"))

    assert events[1][1]["result"]["error"] == "policy_search_unavailable"


async def test_empty_query_is_rejected(harness):
    policy = FakePolicySearch()
    h = harness(FakeLLM(tool("search_policy", {"query": "  "}), text("Neyi aradınız?")), policy)

    events = parse_sse(await h.post("?"))

    assert events[1][1]["result"]["error"] == "invalid_argument"
    assert policy.queries == []


def test_search_policy_is_offered_without_identity_parameters():
    assert list(TOOLS["search_policy"].spec["parameters"]["properties"]) == ["query"]


def test_prompt_restricts_policy_answers_to_search_results():
    prompt = build_system_prompt()
    assert "search_policy" in prompt
    assert "{" not in prompt


needs_db = pytest.mark.skipif(not AGENT_DB_URL, reason="AGENT_TEST_DATABASE_URL is not set")


@pytest.fixture
async def store():
    policy_store = PolicyStore(AGENT_DB_URL)
    await policy_store.connect()
    await policy_store.apply_changes(
        [row.id for row in await policy_store.list_chunks()], [], [], "m1"
    )
    yield policy_store
    await policy_store.close()


def unit_vector(position: int) -> list[float]:
    vector = [0.0] * 768
    vector[position] = 1.0
    return vector


@needs_db
async def test_search_orders_by_similarity_and_filters_by_model(store):
    near, far, other = Chunk("iade", "A", "a"), Chunk("iade", "B", "b"), Chunk("iade", "C", "c")
    await store.apply_changes([], [near, far], [unit_vector(0), unit_vector(1)], "m1")
    await store.apply_changes([], [other], [unit_vector(0)], "m2")

    hits = await store.search(unit_vector(0), "m1", 4)

    assert [hit.section for hit in hits] == ["A", "B"]
    assert hits[0].similarity == pytest.approx(1.0)
    assert hits[1].similarity == pytest.approx(0.0)


@needs_db
async def test_second_index_run_embeds_nothing(store):
    chunks = load_chunks(POLICY_DIR)

    first = FakeEmbedder()
    await run_index(store, first, chunks)
    second = FakeEmbedder()
    plan = await run_index(store, second, chunks)

    assert len(first.embedded) == len(chunks)
    assert second.embedded == []
    assert plan.new_chunks == [] and plan.stale_ids == []


@needs_db
@pytest.mark.parametrize("table", ["customers", "orders", "returns", "shipments"])
async def test_agent_role_cannot_read_customer_tables(table):
    connection = await asyncpg.connect(AGENT_DB_URL)
    try:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await connection.fetch(f"SELECT * FROM {table} LIMIT 1")
    finally:
        await connection.close()
