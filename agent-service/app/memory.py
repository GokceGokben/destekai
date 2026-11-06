"""Conversation memory in Postgres, so a restart or a second instance keeps every conversation.

LangGraph's Postgres checkpointer stores each thread's state after every step. Its tables live
in the agent_memory schema, which the agent's role owns (migration 00008), so the checkpointer
can create and migrate them without any right on the customer tables.
"""

import asyncio
import logging

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)

SCHEMA = "agent_memory"
# How often old conversations are looked for.
CLEANUP_INTERVAL_S = 6 * 3600


class PostgresMemory:
    def __init__(self, database_url: str) -> None:
        self.pool = AsyncConnectionPool(
            database_url,
            open=False,
            min_size=1,
            max_size=4,
            # What the checkpointer expects: autocommit for its migrations, dict rows, and no
            # server-side prepared statements, which break behind connection poolers.
            kwargs={
                "autocommit": True,
                "prepare_threshold": 0,
                "row_factory": dict_row,
                "options": f"-c search_path={SCHEMA}",
            },
        )
        self.saver: AsyncPostgresSaver | None = None

    async def open(self) -> AsyncPostgresSaver:
        """The saver binds to the running event loop, so it is made here, at startup, and
        not when the app object is created at import time."""
        # Fails at startup, not on the first chat, when the database cannot be reached.
        await self.pool.open(wait=True, timeout=10)
        self.saver = AsyncPostgresSaver(self.pool)  # type: ignore[arg-type]
        await self.saver.setup()
        return self.saver

    async def forget_older_than(self, days: int) -> int:
        """Deletes conversations whose last step is older than `days`. Returns how many."""
        assert self.saver is not None
        async with self.pool.connection() as conn:
            rows = await conn.execute(
                """
                SELECT thread_id FROM checkpoints
                GROUP BY thread_id
                HAVING max((checkpoint->>'ts')::timestamptz) < now() - make_interval(days => %s)
                """,
                (days,),
            )
            threads = [row["thread_id"] for row in await rows.fetchall()]
        for thread_id in threads:
            await self.saver.adelete_thread(thread_id)
        return len(threads)

    async def keep_pruned(self, days: int) -> None:
        """Runs for the life of the service: a cleanup at startup, then every few hours."""
        while True:
            try:
                deleted = await self.forget_older_than(days)
                if deleted:
                    logger.info("deleted %d conversations older than %d days", deleted, days)
            except Exception as exc:
                logger.warning("memory cleanup failed: %s", type(exc).__name__)
            await asyncio.sleep(CLEANUP_INTERVAL_S)

    async def close(self) -> None:
        await self.pool.close()
