import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.llm.base import (
    LLMEvent,
    Message,
    RetryableLLMError,
    TextDelta,
    ToolCallRequested,
    ToolSpec,
    Usage,
)

RETRYABLE_STATUS = {429, 503}
# Local models can take minutes to load, so only the connection is held to a short limit.
TIMEOUT = httpx.Timeout(300.0, connect=5.0)


class OllamaClient:
    def __init__(self, base_url: str, model: str) -> None:
        self._http = httpx.AsyncClient(base_url=base_url, timeout=TIMEOUT)
        self._model = model

    async def stream(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> AsyncIterator[LLMEvent]:
        payload = {
            "model": self._model,
            "messages": [{"role": "system", "content": system}, *map(_to_ollama, messages)],
            "tools": [{"type": "function", "function": tool} for tool in tools],
            "stream": True,
        }
        async with self._http.stream("POST", "/api/chat", json=payload) as response:
            if response.status_code in RETRYABLE_STATUS:
                raise RetryableLLMError(_retry_after(response))
            response.raise_for_status()

            async for line in response.aiter_lines():
                if not line:
                    continue
                chunk = json.loads(line)
                message = chunk.get("message", {})
                if message.get("content"):
                    yield TextDelta(message["content"])
                for call in message.get("tool_calls", []):
                    function = call["function"]
                    yield ToolCallRequested(
                        {
                            "id": str(uuid.uuid4()),
                            "name": function["name"],
                            "args": function.get("arguments") or {},
                        }
                    )
                if chunk.get("done"):
                    yield Usage(chunk.get("prompt_eval_count", 0), chunk.get("eval_count", 0))


def _to_ollama(message: Message) -> dict[str, Any]:
    converted: dict[str, Any] = {"role": message["role"], "content": message["content"]}
    if "tool_calls" in message:
        converted["tool_calls"] = [
            {"function": {"name": call["name"], "arguments": call["args"]}}
            for call in message["tool_calls"]
        ]
    if "tool_name" in message:
        converted["tool_name"] = message["tool_name"]
    return converted


def _retry_after(response: httpx.Response) -> float | None:
    value = response.headers.get("Retry-After", "")
    return float(value) if value.isdigit() else None
