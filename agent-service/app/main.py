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
from app.guardrails.pii import install_log_masking
from app.llm import build_llm_client
from app.llm.base import LLMClient, RetryableLLMError
from app.order_api import OrderApiClient
from app.prompts import BUSY_REPLY, ERROR_REPLY
from app.rag.embeddings import build_embedding_client
from app.rag.search import PolicySearch
from app.rag.store import PolicyStore
from app.tools import ToolDeps

logger = logging.getLogger(__name__)

MIN_SECRET_LENGTH = 32


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
        # The message goes in as "incoming": guard decides whether it joins the conversation.
        turn = {"incoming": body.message, "steps": 0, "turn_failures": [], "turn_successes": 0}
        chunks = graph.astream(
            turn,
            config={
                "configurable": {"thread_id": thread_id(session.customer_id, body.conversation_id)}
            },
            context=AgentContext(token=session.token, conversation_id=body.conversation_id),
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
        # Only the type: an exception message can carry customer text, and tracebacks are
        # not masked.
        logger.error("chat failed: %s", type(exc).__name__)
        yield _sse("error", {"message": ERROR_REPLY})


def create_app(
    settings: Settings | None = None,
    llm: LLMClient | None = None,
    order_api: OrderApiClient | None = None,
    policy_search: PolicySearch | None = None,
) -> FastAPI:
    install_log_masking()
    settings = settings or Settings()
    # The indexer shares Settings but signs nothing, so this is checked here.
    if len(settings.jwt_secret.get_secret_value()) < MIN_SECRET_LENGTH:
        raise ValueError(f"JWT_SECRET must be at least {MIN_SECRET_LENGTH} characters")
    llm = llm or build_llm_client(settings)
    order_api = order_api or OrderApiClient(settings.order_api_url)
    policy_search = policy_search or PolicySearch(
        build_embedding_client(settings), PolicyStore(settings.database_url.get_secret_value())
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await policy_search.connect()
        yield
        await policy_search.close()
        await order_api.close()

    app = FastAPI(title="DestekAI agent service", lifespan=lifespan)
    app.state.settings = settings
    deps = ToolDeps(order_api=order_api, policy_search=policy_search)
    app.state.graph = build_graph(llm, deps, InMemorySaver())

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
