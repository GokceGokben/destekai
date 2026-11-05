"""A trace per answered message: latency, tokens, cost, tools and outcome.

Traces go to the project's own Postgres by default, so nothing leaves the machine and no
extra service runs. Langfuse is optional: with its keys set, each trace is also sent to its
public ingestion API. A failed write is logged and never breaks the chat.
"""

import base64
import json
import logging
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Protocol

import asyncpg
import httpx

from app.guardrails.pii import mask_pii

logger = logging.getLogger(__name__)

# Long replies are cut: the trace is for latency and cost, not a transcript archive.
TEXT_LIMIT = 2000


@dataclass
class TurnTrace:
    conversation_id: str
    customer_id: str
    read_only: bool
    model: str
    started_at: datetime
    customer_text: str
    reply_text: str = ""
    outcome: str = "answered"
    latency_ms: int = 0
    first_token_ms: int | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    tools: list[dict[str, Any]] = field(default_factory=list)

    def masked(self) -> "TurnTrace":
        """Every text goes through the PII mask before it is stored or sent."""
        return TurnTrace(
            **asdict(self)
            | {
                "customer_text": mask_pii(self.customer_text)[:TEXT_LIMIT],
                "reply_text": mask_pii(self.reply_text)[:TEXT_LIMIT],
            }
        )


def cost_of(
    input_tokens: int, output_tokens: int, price_in: float | None, price_out: float | None
) -> float | None:
    if price_in is None or price_out is None:
        return None
    return round(input_tokens * price_in / 1e6 + output_tokens * price_out / 1e6, 6)


class TraceSink(Protocol):
    async def record(self, trace: TurnTrace) -> None: ...


class PostgresTraceSink:
    def __init__(self, database_url: str) -> None:
        self._url = database_url
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        self._pool = await asyncpg.create_pool(self._url, min_size=1, max_size=2)

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

    async def record(self, trace: TurnTrace) -> None:
        assert self._pool is not None
        await self._pool.execute(
            """
            INSERT INTO agent_traces (conversation_id, customer_id, read_only, model, outcome,
                started_at, latency_ms, first_token_ms, input_tokens, output_tokens, cost_usd,
                tools, customer_text, reply_text)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
            """,
            trace.conversation_id,
            trace.customer_id,
            trace.read_only,
            trace.model,
            trace.outcome,
            trace.started_at,
            trace.latency_ms,
            trace.first_token_ms,
            trace.input_tokens,
            trace.output_tokens,
            trace.cost_usd,
            _json(trace.tools),
            trace.customer_text,
            trace.reply_text,
        )


class LangfuseTraceSink:
    """Langfuse's public ingestion API over httpx, so no SDK is needed. Off unless both keys
    are configured."""

    def __init__(self, host: str, public_key: str, secret_key: str) -> None:
        credentials = base64.b64encode(f"{public_key}:{secret_key}".encode()).decode()
        self._http = httpx.AsyncClient(
            base_url=host.rstrip("/"),
            headers={"Authorization": f"Basic {credentials}"},
            timeout=10.0,
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def record(self, trace: TurnTrace) -> None:
        trace_id = str(uuid.uuid4())
        timestamp = trace.started_at.isoformat()
        events = [
            {
                "id": str(uuid.uuid4()),
                "type": "trace-create",
                "timestamp": timestamp,
                "body": {
                    "id": trace_id,
                    "name": "chat",
                    "sessionId": trace.conversation_id,
                    "userId": trace.customer_id,
                    "input": trace.customer_text,
                    "output": trace.reply_text,
                    "metadata": {"outcome": trace.outcome, "read_only": trace.read_only},
                },
            },
            {
                "id": str(uuid.uuid4()),
                "type": "generation-create",
                "timestamp": timestamp,
                "body": {
                    "id": str(uuid.uuid4()),
                    "traceId": trace_id,
                    "name": "agent",
                    "model": trace.model,
                    "startTime": timestamp,
                    "usage": {"input": trace.input_tokens, "output": trace.output_tokens},
                    "metadata": {"latency_ms": trace.latency_ms, "tools": trace.tools},
                },
            },
        ]
        response = await self._http.post("/api/public/ingestion", json={"batch": events})
        response.raise_for_status()


class Tracer:
    def __init__(self, sinks: list[TraceSink]) -> None:
        self.sinks = sinks

    async def record(self, trace: TurnTrace) -> None:
        masked = trace.masked()
        for sink in self.sinks:
            try:
                await sink.record(masked)
            except Exception as exc:
                logger.warning(
                    "trace not recorded by %s: %s", type(sink).__name__, type(exc).__name__
                )


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)
