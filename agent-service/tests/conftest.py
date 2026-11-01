import json
from collections.abc import AsyncIterator

import httpx
import pytest
import respx
from pydantic import SecretStr

from app.auth import issue_dev_token
from app.config import Settings
from app.llm.base import LLMEvent, Message, TextDelta, ToolCallRequested, ToolSpec, Usage
from app.main import create_app
from app.order_api import OrderApiClient

SECRET = "test-secret-test-secret-test-secret"
ORDER_API_URL = "http://order-api.test"


def text(reply: str) -> list[LLMEvent]:
    return [TextDelta(reply), Usage(10, 5)]


def tool(name: str, args: dict | None = None, call_id: str = "call-1") -> list[LLMEvent]:
    return [ToolCallRequested({"id": call_id, "name": name, "args": args or {}}), Usage(10, 5)]


class FakeLLM:
    """Replays scripted replies and records what the model would have been sent."""

    def __init__(self, *replies: list[LLMEvent]) -> None:
        self.replies = list(replies)
        self.calls: list[dict] = []

    async def stream(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> AsyncIterator[LLMEvent]:
        self.calls.append({"system": system, "messages": list(messages), "tools": tools})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        for event in reply:
            yield event


class FakePolicySearch:
    def __init__(self, results: list[dict] | None = None) -> None:
        self.results = results or []
        self.queries: list[str] = []

    async def search(self, query: str) -> list[dict]:
        self.queries.append(query)
        if isinstance(self.results, Exception):
            raise self.results
        return self.results


class Harness:
    def __init__(self, llm: FakeLLM, policy_search: FakePolicySearch | None = None) -> None:
        self.llm = llm
        settings = Settings(
            jwt_secret=SecretStr(SECRET),
            llm_provider="ollama",
            embedding_provider="local",
            order_api_url=ORDER_API_URL,
        )
        self.app = create_app(
            settings,
            llm=llm,
            order_api=OrderApiClient(ORDER_API_URL),
            policy_search=policy_search or FakePolicySearch(),
        )

    async def post(self, message: str, customer: str = "CUS-1001", conversation: str = "c1"):
        token = issue_dev_token(SECRET, customer)
        return await self.post_with_token(token, message, conversation)

    async def post_with_token(self, token: str, message: str, conversation: str = "c1"):
        transport = httpx.ASGITransport(app=self.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://agent") as http:
            return await http.post(
                "/v1/chat",
                json={"conversation_id": conversation, "message": message},
                headers={"Authorization": f"Bearer {token}"},
            )


def parse_sse(response: httpx.Response) -> list[tuple[str, dict]]:
    events = []
    name = None
    for line in response.text.splitlines():
        if line.startswith("event:"):
            name = line.removeprefix("event:").strip()
        elif line.startswith("data:"):
            events.append((name, json.loads(line.removeprefix("data:"))))
    return events


@pytest.fixture
def harness():
    return Harness


@pytest.fixture
def order_api():
    # respx lets a test fail if the agent calls a URL it was not expected to call.
    with respx.mock(base_url=ORDER_API_URL, assert_all_called=False) as router:
        yield router
