"""The provider-independent LLM interface.

Messages are plain dicts because the LangGraph checkpointer stores them as they are.
"""

import asyncio
import logging
import random
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, NotRequired, Protocol, TypedDict

logger = logging.getLogger(__name__)


class ToolCall(TypedDict):
    id: str
    name: str
    args: dict[str, Any]
    # Gemini 3 rejects a follow-up request unless this opaque value is sent back.
    signature: NotRequired[str]


class Message(TypedDict):
    role: Literal["user", "assistant", "tool"]
    content: str
    tool_calls: NotRequired[list[ToolCall]]  # assistant only
    tool_call_id: NotRequired[str]  # tool only
    tool_name: NotRequired[str]  # tool only


class ToolSpec(TypedDict):
    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class ToolCallRequested:
    call: ToolCall


@dataclass(frozen=True)
class Usage:
    input_tokens: int
    output_tokens: int


LLMEvent = TextDelta | ToolCallRequested | Usage


class RetryableLLMError(Exception):
    """The provider is rate limited, overloaded or too slow to answer."""

    def __init__(self, retry_after: float | None = None) -> None:
        super().__init__(f"retryable LLM error, retry_after={retry_after}")
        self.retry_after = retry_after


class LLMClient(Protocol):
    def stream(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> AsyncIterator[LLMEvent]: ...


class RetryingLLMClient:
    """Adds exponential backoff with jitter to another client."""

    def __init__(
        self,
        client: LLMClient,
        max_retries: int = 2,
        base_delay: float = 1.0,
        max_delay: float = 30.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._client = client
        self._max_retries = max_retries
        self._base_delay = base_delay
        self._max_delay = max_delay
        self._sleep = sleep

    async def stream(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> AsyncIterator[LLMEvent]:
        for attempt in range(self._max_retries + 1):
            started = False
            try:
                async for event in self._client.stream(system, messages, tools):
                    started = True
                    yield event
                return
            except RetryableLLMError as exc:
                # After the first event a retry would show the customer repeated text.
                if started or attempt == self._max_retries:
                    raise
                delay = self._delay(attempt, exc.retry_after)
                # A long wait usually means a spent daily quota; failing fast is kinder.
                if delay > self._max_delay:
                    raise
                logger.warning("LLM retry %d in %.1fs", attempt + 1, delay)
                await self._sleep(delay)

    def _delay(self, attempt: int, retry_after: float | None) -> float:
        if retry_after is not None:
            return retry_after
        backoff = min(self._base_delay * 2**attempt, self._max_delay)
        # Jitter keeps parallel clients from retrying in lockstep.
        return backoff * random.uniform(0.5, 1.0)
