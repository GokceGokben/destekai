"""Database access for the evaluation: reset to the seed, then read what a conversation did."""

from dataclasses import dataclass
from datetime import datetime

import asyncpg

from evals import ROOT

SEED_SQL = ROOT / "order-api" / "internal" / "seed" / "seed.sql"


@dataclass(frozen=True)
class DbState:
    """Rows created by one conversation."""

    new_returns: list[str]  # order IDs
    handoff_reason: str | None


class EvalDatabase:
    def __init__(self, url: str) -> None:
        self._url = url
        self._conn: asyncpg.Connection | None = None

    async def __aenter__(self) -> "EvalDatabase":
        self._conn = await asyncpg.connect(self._url)
        return self

    async def __aexit__(self, *exc: object) -> None:
        assert self._conn is not None
        await self._conn.close()

    async def reset(self) -> datetime:
        """Applies the order API's own seed, so each scenario starts from the same data and
        its relative dates are fresh. Returns the database's clock afterwards, which is what
        new rows are compared against."""
        assert self._conn is not None
        async with self._conn.transaction():
            await self._conn.execute(SEED_SQL.read_text(encoding="utf-8"))
        return await self._conn.fetchval("SELECT clock_timestamp()")

    async def state(self, customer_id: str, conversation_id: str, since: datetime) -> DbState:
        assert self._conn is not None
        returns = await self._conn.fetch(
            "SELECT order_id FROM returns WHERE created_at >= $1 ORDER BY order_id", since
        )
        reason = await self._conn.fetchval(
            "SELECT reason FROM handoffs WHERE customer_id = $1 AND conversation_id = $2",
            customer_id,
            conversation_id,
        )
        return DbState(new_returns=[row["order_id"] for row in returns], handoff_reason=reason)
