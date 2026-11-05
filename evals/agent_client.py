"""Talks to the running agent over its real SSE endpoint, as the browser does."""

import time
import uuid
from typing import Any

import httpx
from app.auth import issue_dev_token
from app.cli import read_events
from pydantic import BaseModel

# The agent's own message when its model is rate limited; the run stops on it.
BUSY_MARKER = "yoğunluk"


class ToolTrace(BaseModel):
    name: str
    args: dict[str, Any]
    result: dict[str, Any] | None = None


class AgentTurn(BaseModel):
    customer: str
    reply: str = ""
    tools: list[ToolTrace] = []
    guardrail: bool = False
    handoff_reason: str | None = None
    ungrounded: list[str] = []
    error: str | None = None
    first_token_ms: float | None = None
    latency_ms: float = 0
    input_tokens: int = 0
    output_tokens: int = 0


class AgentClient:
    def __init__(self, base_url: str, jwt_secret: str, customer_id: str) -> None:
        token = issue_dev_token(jwt_secret, customer_id)
        self._http = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=httpx.Timeout(10.0, read=180.0),
        )
        self.conversation_id = f"eval-{uuid.uuid4().hex[:12]}"

    async def __aenter__(self) -> "AgentClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._http.aclose()

    async def send(self, message: str) -> AgentTurn:
        turn = AgentTurn(customer=message)
        body = {"conversation_id": self.conversation_id, "message": message}
        started = time.perf_counter()

        def elapsed() -> float:
            return round((time.perf_counter() - started) * 1000, 1)

        async with self._http.stream("POST", "/v1/chat", json=body) as response:
            if response.is_error:
                turn.error = f"http {response.status_code}"
                return turn
            async for event, data in read_events(response):
                match event:
                    case "token":
                        if turn.first_token_ms is None:
                            turn.first_token_ms = elapsed()
                        turn.reply += data["text"]
                    case "tool_call":
                        turn.tools.append(ToolTrace(name=data["name"], args=data["args"]))
                    case "tool_result":
                        turn.tools[-1].result = data["result"]
                    case "guardrail":
                        turn.guardrail = True
                    case "handoff":
                        turn.handoff_reason = data["reason"]
                    case "grounding_violation":
                        turn.ungrounded.extend(data["references"])
                    case "done":
                        turn.input_tokens = data["usage"]["input_tokens"]
                        turn.output_tokens = data["usage"]["output_tokens"]
                    case "error":
                        turn.error = data["message"]
        turn.latency_ms = elapsed()
        return turn
