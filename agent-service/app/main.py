import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.agent import AgentContext, build_graph
from app.auth import InvalidTokenError, verify_token
from app.config import Settings
from app.llm import build_llm_client
from app.llm.base import LLMClient, RetryableLLMError
from app.order_api import OrderApiClient
from app.prompts import BUSY_REPLY, ERROR_REPLY

logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    # The pattern excludes ":", so a thread ID can only be split in one way.
    conversation_id: str = Field(pattern=r"^[A-Za-z0-9-]{1,64}$")
    message: str = Field(min_length=1, max_length=2000)


@dataclass(frozen=True)
class Session:
    customer_id: str
    token: str


def current_session(
    request: Request, authorization: Annotated[str | None, Header()] = None
) -> Session:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme != "Bearer" or not token:
        raise HTTPException(status_code=401, detail="unauthorized")
    secret = request.app.state.settings.jwt_secret.get_secret_value()
    try:
        return Session(customer_id=verify_token(secret, token), token=token)
    except InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="unauthorized") from exc


def thread_id(customer_id: str, conversation_id: str) -> str:
    """Scopes memory to the customer, so a leaked conversation ID opens nothing."""
    return f"{customer_id}:{conversation_id}"


def _sse(event: str, data: dict[str, Any]) -> dict[str, str]:
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}


async def chat_events(graph: Any, session: Session, body: ChatRequest) -> AsyncIterator[dict]:
    usage = {"input_tokens": 0, "output_tokens": 0}
    try:
        chunks = graph.astream(
            {"messages": [{"role": "user", "content": body.message}], "steps": 0},
            config={
                "configurable": {"thread_id": thread_id(session.customer_id, body.conversation_id)}
            },
            context=AgentContext(token=session.token),
            stream_mode="custom",
        )
        async for chunk in chunks:
            if chunk["type"] == "usage":
                usage["input_tokens"] += chunk["data"]["input_tokens"]
                usage["output_tokens"] += chunk["data"]["output_tokens"]
            else:
                yield _sse(chunk["type"], chunk["data"])
        yield _sse("done", {"usage": usage})
    except RetryableLLMError:
        logger.warning("LLM provider is rate limited")
        yield _sse("error", {"message": BUSY_REPLY})
    except Exception as exc:
        # Only the type: messages can carry customer text, and masking arrives in Phase 5.
        logger.error("chat failed: %s", type(exc).__name__)
        yield _sse("error", {"message": ERROR_REPLY})


def create_app(
    settings: Settings | None = None,
    llm: LLMClient | None = None,
    order_api: OrderApiClient | None = None,
) -> FastAPI:
    settings = settings or Settings()
    llm = llm or build_llm_client(settings)
    order_api = order_api or OrderApiClient(settings.order_api_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await order_api.close()

    app = FastAPI(title="DestekAI agent service", lifespan=lifespan)
    app.state.settings = settings
    app.state.graph = build_graph(llm, order_api, InMemorySaver())

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    # POST, not GET: the message and token stay out of URLs and access logs.
    @app.post("/v1/chat")
    async def chat(
        body: ChatRequest, session: Annotated[Session, Depends(current_session)]
    ) -> EventSourceResponse:
        return EventSourceResponse(chat_events(app.state.graph, session, body))

    return app
