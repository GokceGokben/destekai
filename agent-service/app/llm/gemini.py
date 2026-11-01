import base64
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
from google import genai
from google.genai import errors, types

from app.llm.base import (
    LLMEvent,
    Message,
    RetryableLLMError,
    TextDelta,
    ToolCall,
    ToolCallRequested,
    ToolSpec,
    Usage,
)

RETRYABLE_STATUS = {429, 503, 504}
# The SDK has no default timeout, so a stalled model would hang the chat request.
REQUEST_TIMEOUT_MS = 30_000
LOCAL_ID_PREFIX = "local-"


class GeminiClient:
    def __init__(self, api_key: str, model: str) -> None:
        self._client = genai.Client(
            api_key=api_key, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS)
        )
        self._model = model

    async def stream(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> AsyncIterator[LLMEvent]:
        config = types.GenerateContentConfig(
            system_instruction=system,
            tools=[types.Tool(function_declarations=[_declaration(tool) for tool in tools])],
        )
        usage = None
        try:
            chunks = await self._client.aio.models.generate_content_stream(
                model=self._model, contents=to_contents(messages), config=config
            )
            async for chunk in chunks:
                usage = chunk.usage_metadata or usage
                for part in _parts(chunk):
                    if part.function_call:
                        yield ToolCallRequested(_tool_call(part))
                    elif part.text and not part.thought:
                        yield TextDelta(part.text)
        except errors.APIError as exc:
            if exc.code in RETRYABLE_STATUS:
                raise RetryableLLMError(retry_delay(exc)) from exc
            raise
        except httpx.TimeoutException as exc:
            raise RetryableLLMError() from exc

        if usage:
            yield Usage(
                input_tokens=usage.prompt_token_count or 0,
                # Thinking tokens are billed as output.
                output_tokens=(usage.candidates_token_count or 0)
                + (usage.thoughts_token_count or 0),
            )


def _declaration(tool: ToolSpec) -> types.FunctionDeclaration:
    return types.FunctionDeclaration(
        name=tool["name"],
        description=tool["description"],
        parameters_json_schema=tool["parameters"],
    )


def _parts(chunk: types.GenerateContentResponse) -> list[types.Part]:
    if not chunk.candidates or not chunk.candidates[0].content:
        return []
    return chunk.candidates[0].content.parts or []


def _tool_call(part: types.Part) -> ToolCall:
    function_call = part.function_call
    call: ToolCall = {
        "id": function_call.id or f"{LOCAL_ID_PREFIX}{uuid.uuid4()}",
        "name": function_call.name,
        "args": dict(function_call.args or {}),
    }
    if part.thought_signature:
        # Base64 keeps the checkpointed message JSON-friendly.
        call["signature"] = base64.b64encode(part.thought_signature).decode()
    return call


def to_contents(messages: list[Message]) -> list[types.Content]:
    contents: list[types.Content] = []
    for message in messages:
        if message["role"] == "user":
            contents.append(types.Content(role="user", parts=[types.Part(text=message["content"])]))
        elif message["role"] == "assistant":
            contents.append(types.Content(role="model", parts=_assistant_parts(message)))
        else:
            part = _tool_response_part(message)
            # Results of parallel calls must arrive in a single turn.
            previous = contents[-1] if contents else None
            if previous and previous.parts and previous.parts[0].function_response:
                previous.parts.append(part)
            else:
                contents.append(types.Content(role="user", parts=[part]))
    return contents


def _assistant_parts(message: Message) -> list[types.Part]:
    parts = [types.Part(text=message["content"])] if message["content"] else []
    for call in message.get("tool_calls", []):
        signature = call.get("signature")
        parts.append(
            types.Part(
                function_call=types.FunctionCall(
                    id=_api_id(call["id"]), name=call["name"], args=call["args"]
                ),
                thought_signature=base64.b64decode(signature) if signature else None,
            )
        )
    return parts


def _tool_response_part(message: Message) -> types.Part:
    return types.Part(
        function_response=types.FunctionResponse(
            id=_api_id(message["tool_call_id"]),
            name=message["tool_name"],
            response={"result": json.loads(message["content"])},
        )
    )


def _api_id(call_id: str) -> str | None:
    """Gemini does not always send call IDs; ours must not be echoed back as if they were its."""
    return None if call_id.startswith(LOCAL_ID_PREFIX) else call_id


def retry_delay(error: errors.APIError) -> float | None:
    """Reads the wait time from Gemini's RetryInfo detail, e.g. {"retryDelay": "17s"}."""
    details: Any = error.details if isinstance(error.details, dict) else {}
    details = details.get("error", details).get("details", [])
    for detail in details:
        delay = detail.get("retryDelay")
        if delay:
            return float(delay.rstrip("s"))
    return None
