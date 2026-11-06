"""Conversation memory survives a restart. Needs a real Postgres: AGENT_TEST_DATABASE_URL, the
agent role on the test database after the order API's migrations (make test runs them)."""

import os
import uuid

import httpx
import pytest
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app
from app.order_api import OrderApiClient
from app.tracing import Tracer
from tests.conftest import ORDER_API_URL, FakeLLM, FakePolicySearch, text
from tests.tokens import PUBLIC_KEY, make_token

AGENT_DB_URL = os.environ.get("AGENT_TEST_DATABASE_URL")
needs_db = pytest.mark.skipif(not AGENT_DB_URL, reason="AGENT_TEST_DATABASE_URL is not set")


async def say(llm: FakeLLM, conversation: str, message: str) -> None:
    """One message to a fresh app instance, started and stopped like the real service."""
    settings = Settings(
        database_url=SecretStr(AGENT_DB_URL or ""),
        llm_provider="ollama",
        embedding_provider="local",
        order_api_url=ORDER_API_URL,
    )
    app = create_app(
        settings,
        llm=llm,
        order_api=OrderApiClient(ORDER_API_URL),
        policy_search=FakePolicySearch(),
        tracer=Tracer([]),
        public_key=PUBLIC_KEY,
    )
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://agent") as http:
            response = await http.post(
                "/v1/chat",
                json={"conversation_id": conversation, "message": message},
                headers={"Authorization": f"Bearer {make_token('CUS-1001')}"},
            )
            assert response.status_code == 200


@needs_db
async def test_a_restart_keeps_the_conversation():
    llm = FakeLLM(text("Merhaba Ayşe"), text("Ayşe demiştiniz"))
    conversation = f"memory-{uuid.uuid4().hex[:8]}"

    await say(llm, conversation, "Adım Ayşe")
    await say(llm, conversation, "Adım neydi?")  # a new instance: nothing left in memory

    contents = [message["content"] for message in llm.calls[1]["messages"]]
    assert contents == ["Adım Ayşe", "Merhaba Ayşe", "Adım neydi?"]


@needs_db
async def test_the_checkpointer_writes_only_to_its_own_schema():
    import psycopg

    async with await psycopg.AsyncConnection.connect(AGENT_DB_URL) as conn:
        rows = await conn.execute(
            "SELECT table_schema FROM information_schema.tables WHERE table_name = 'checkpoints'"
        )
        assert {row[0] for row in await rows.fetchall()} == {"agent_memory"}
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            await conn.execute("SELECT count(*) FROM public.customers")


@needs_db
async def test_old_conversations_are_deleted_and_recent_ones_kept():
    import psycopg

    from app.memory import PostgresMemory

    old, recent = f"old-{uuid.uuid4().hex[:8]}", f"new-{uuid.uuid4().hex[:8]}"
    await say(FakeLLM(text("Tamam")), old, "Eski konuşma")
    await say(FakeLLM(text("Tamam")), recent, "Yeni konuşma")
    async with await psycopg.AsyncConnection.connect(AGENT_DB_URL, autocommit=True) as conn:
        await conn.execute(
            "UPDATE agent_memory.checkpoints SET checkpoint = jsonb_set(checkpoint, '{ts}',"
            " '\"2020-01-01T00:00:00+00:00\"') WHERE thread_id LIKE %s",
            (f"%:{old}",),
        )

    memory = PostgresMemory(AGENT_DB_URL or "")
    await memory.open()
    try:
        assert await memory.forget_older_than(30) >= 1
    finally:
        await memory.close()

    async with await psycopg.AsyncConnection.connect(AGENT_DB_URL) as conn:
        rows = await conn.execute("SELECT DISTINCT thread_id FROM agent_memory.checkpoints")
        threads = {row[0] for row in await rows.fetchall()}
    assert not any(thread.endswith(f":{old}") for thread in threads)
    assert any(thread.endswith(f":{recent}") for thread in threads)
