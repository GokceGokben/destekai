import base64
from types import SimpleNamespace

import httpx
import pytest
from google.genai import errors, types

from app.llm.base import RetryableLLMError, TextDelta, ToolCallRequested, Usage
from app.llm.gemini import GeminiClient


def chunk(parts: list[types.Part], usage: types.GenerateContentResponseUsageMetadata | None = None):
    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(role="model", parts=parts))],
        usage_metadata=usage,
    )


def client_returning(result) -> tuple[GeminiClient, dict]:
    captured: dict = {}

    async def generate_content_stream(**kwargs):
        captured.update(kwargs)
        if isinstance(result, Exception):
            raise result

        async def chunks():
            for item in result:
                yield item

        return chunks()

    client = GeminiClient("fake-key", "gemini-test")
    models = SimpleNamespace(generate_content_stream=generate_content_stream)
    client._client = SimpleNamespace(aio=SimpleNamespace(models=models))
    return client, captured


async def collect(client) -> list:
    tools = [{"name": "t", "description": "d", "parameters": {"type": "object", "properties": {}}}]
    return [event async for event in client.stream("system", [], tools)]


async def test_stream_maps_text_tool_calls_and_usage():
    usage = types.GenerateContentResponseUsageMetadata(
        prompt_token_count=100, candidates_token_count=20, thoughts_token_count=5
    )
    call = types.Part(
        function_call=types.FunctionCall(id="abc", name="t", args={"order_id": "DA-100001"}),
        thought_signature=b"opaque",
    )
    client, captured = client_returning(
        [
            chunk([types.Part(text="düşünce", thought=True)]),
            chunk([types.Part(text="Mer")]),
            chunk([types.Part(text="haba"), call], usage),
        ]
    )
    events = await collect(client)

    assert events[:2] == [TextDelta("Mer"), TextDelta("haba")]
    assert events[2] == ToolCallRequested(
        {
            "id": "abc",
            "name": "t",
            "args": {"order_id": "DA-100001"},
            "signature": base64.b64encode(b"opaque").decode(),
        }
    )
    assert events[3] == Usage(100, 25)
    assert captured["model"] == "gemini-test"
    assert captured["config"].system_instruction == "system"


async def test_call_without_id_gets_a_local_one():
    part = types.Part(function_call=types.FunctionCall(name="t", args={}))
    client, _ = client_returning([chunk([part])])
    events = await collect(client)
    assert events[0].call["id"].startswith("local-")


@pytest.mark.parametrize("status", [429, 503, 504])
async def test_overload_statuses_are_retryable(status):
    error_type = errors.ClientError if status == 429 else errors.ServerError
    client, _ = client_returning(error_type(status, {"error": {"code": status}}))
    with pytest.raises(RetryableLLMError):
        await collect(client)


async def test_timeout_is_retryable():
    client, _ = client_returning(httpx.ReadTimeout("slow"))
    with pytest.raises(RetryableLLMError):
        await collect(client)


async def test_bad_request_is_not_retryable():
    client, _ = client_returning(errors.ClientError(400, {"error": {"code": 400}}))
    with pytest.raises(errors.ClientError):
        await collect(client)
