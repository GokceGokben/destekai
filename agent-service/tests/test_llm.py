import base64
import json

import httpx
import pytest
import respx
from google.genai import errors

from app.llm.base import (
    Message,
    RetryableLLMError,
    RetryingLLMClient,
    TextDelta,
    ToolCallRequested,
    Usage,
)
from app.llm.gemini import retry_delay, to_contents
from app.llm.ollama import OllamaClient
from tests.conftest import FakeLLM, text


class Clock:
    def __init__(self) -> None:
        self.delays: list[float] = []

    async def sleep(self, delay: float) -> None:
        self.delays.append(delay)


async def collect(client) -> list:
    return [event async for event in client.stream("system", [], [])]


async def test_retries_rate_limits_with_growing_backoff():
    clock = Clock()
    inner = FakeLLM(RetryableLLMError(), RetryableLLMError(), text("Tamam"))
    events = await collect(RetryingLLMClient(inner, sleep=clock.sleep))

    assert TextDelta("Tamam") in events
    assert len(clock.delays) == 2
    # Jitter is at most 50%, so the second wait always covers the first one's ceiling.
    assert 0.5 <= clock.delays[0] <= 1.0
    assert 1.0 <= clock.delays[1] <= 2.0


async def test_retry_after_overrides_backoff():
    clock = Clock()
    inner = FakeLLM(RetryableLLMError(retry_after=7), text("Tamam"))
    await collect(RetryingLLMClient(inner, sleep=clock.sleep))
    assert clock.delays == [7]


async def test_gives_up_after_max_retries():
    clock = Clock()
    inner = FakeLLM(*[RetryableLLMError() for _ in range(3)])
    with pytest.raises(RetryableLLMError):
        await collect(RetryingLLMClient(inner, max_retries=2, sleep=clock.sleep))
    assert len(clock.delays) == 2


async def test_long_retry_after_fails_fast():
    clock = Clock()
    inner = FakeLLM(RetryableLLMError(retry_after=3600))
    with pytest.raises(RetryableLLMError):
        await collect(RetryingLLMClient(inner, sleep=clock.sleep))
    assert clock.delays == []


async def test_never_retries_after_output_has_started():
    class FailsMidStream:
        calls = 0

        async def stream(self, system, messages, tools):
            FailsMidStream.calls += 1
            yield TextDelta("Yarım")
            raise RetryableLLMError()

    clock = Clock()
    with pytest.raises(RetryableLLMError):
        await collect(RetryingLLMClient(FailsMidStream(), sleep=clock.sleep))
    assert FailsMidStream.calls == 1


async def test_other_errors_are_not_retried():
    inner = FakeLLM(ValueError("bad request"))
    with pytest.raises(ValueError):
        await collect(RetryingLLMClient(inner))


def test_gemini_history_keeps_signature_and_groups_parallel_results():
    signature = base64.b64encode(b"opaque").decode()
    messages: list[Message] = [
        {"role": "user", "content": "Siparişlerim?"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {"id": "a", "name": "track_shipment", "args": {}, "signature": signature},
                {"id": "local-1", "name": "list_my_orders", "args": {}},
            ],
        },
        {
            "role": "tool",
            "content": '{"ok": 1}',
            "tool_call_id": "a",
            "tool_name": "track_shipment",
        },
        {
            "role": "tool",
            "content": '{"ok": 2}',
            "tool_call_id": "local-1",
            "tool_name": "list_my_orders",
        },
    ]
    contents = to_contents(messages)

    assert [content.role for content in contents] == ["user", "model", "user"]
    model_parts = contents[1].parts
    assert model_parts[0].thought_signature == b"opaque"
    assert model_parts[0].function_call.id == "a"
    assert model_parts[1].thought_signature is None
    assert model_parts[1].function_call.id is None

    results = contents[2].parts
    assert [part.function_response.name for part in results] == [
        "track_shipment",
        "list_my_orders",
    ]
    assert results[1].function_response.response == {"result": {"ok": 2}}


def test_gemini_retry_delay_is_read_from_retry_info():
    body = {
        "error": {
            "code": 429,
            "details": [
                {"@type": "type.googleapis.com/google.rpc.QuotaFailure"},
                {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "17s"},
            ],
        }
    }
    assert retry_delay(errors.ClientError(429, body)) == 17.0
    assert retry_delay(errors.ClientError(429, {"error": {"code": 429}})) is None


async def test_ollama_parses_stream_and_tool_calls():
    lines = [
        {"message": {"content": "Mer"}},
        {"message": {"content": "haba"}},
        {"message": {"tool_calls": [{"function": {"name": "list_my_orders", "arguments": {}}}]}},
        {"done": True, "prompt_eval_count": 12, "eval_count": 3},
    ]
    body = "\n".join(json.dumps(line) for line in lines)
    with respx.mock(base_url="http://ollama.test") as router:
        router.post("/api/chat").mock(return_value=httpx.Response(200, text=body))
        events = await collect(OllamaClient("http://ollama.test", "model"))

    assert events[:2] == [TextDelta("Mer"), TextDelta("haba")]
    assert isinstance(events[2], ToolCallRequested)
    assert events[2].call["name"] == "list_my_orders"
    assert events[3] == Usage(12, 3)


async def test_ollama_429_is_retryable():
    with respx.mock(base_url="http://ollama.test") as router:
        router.post("/api/chat").mock(
            return_value=httpx.Response(429, headers={"Retry-After": "3"})
        )
        with pytest.raises(RetryableLLMError) as exc_info:
            await collect(OllamaClient("http://ollama.test", "model"))
    assert exc_info.value.retry_after == 3
