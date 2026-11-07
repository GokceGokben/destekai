import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.agent import AgentContext, build_graph
from app.auth import InvalidTokenError, load_public_key, verify_token
from app.config import Settings
from app.guardrails.pii import install_log_masking
from app.llm import build_llm_client
from app.llm.base import LLMClient, RetryableLLMError
from app.memory import PostgresMemory
from app.order_api import OrderApiClient
from app.prompts import BUSY_REPLY, ERROR_REPLY
from app.rag.embeddings import build_embedding_client
from app.rag.search import PolicySearch
from app.rag.store import PolicyStore
from app.ratelimit import ChatLimiter
from app.tools import ToolDeps
from app.tracing import (
    LangfuseTraceSink,
    PostgresTraceSink,
    Tracer,
    TurnTrace,
    cost_of,
)

logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    # The pattern excludes ":", so a thread ID can only be split in one way.
    conversation_id: str = Field(pattern=r"^[A-Za-z0-9-]{1,64}$")
    message: str = Field(min_length=1, max_length=2000)


@dataclass(frozen=True)
class Session:
    customer_id: str
    token: str
    read_only: bool = False
    admin_id: str | None = None


def current_session(
    request: Request, authorization: Annotated[str | None, Header()] = None
) -> Session:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme != "Bearer" or not token:
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        claims = verify_token(request.app.state.public_key, token)
    except InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="unauthorized") from exc
    return Session(
        customer_id=claims.customer_id,
        token=token,
        read_only=claims.read_only,
        admin_id=claims.admin_id,
    )


def thread_id(session: Session, conversation_id: str) -> str:
    """Scopes memory to the customer, so a leaked conversation ID opens nothing. An admin's
    view gets its own threads: it never reads or continues the customer's conversations."""
    if session.read_only:
        return f"view:{session.admin_id}:{session.customer_id}:{conversation_id}"
    return f"{session.customer_id}:{conversation_id}"


def _sse(event: str, data: dict[str, Any]) -> dict[str, str]:
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}


async def chat_events(
    graph: Any, session: Session, body: ChatRequest, tracer: Tracer, settings: Settings
) -> AsyncIterator[dict]:
    usage = {"input_tokens": 0, "output_tokens": 0}
    trace = TurnTrace(
        conversation_id=body.conversation_id,
        customer_id=session.customer_id,
        read_only=session.read_only,
        model=settings.llm_model,
        started_at=datetime.now(UTC),
        customer_text=body.message,
    )
    started = time.perf_counter()

    def elapsed_ms() -> int:
        return round((time.perf_counter() - started) * 1000)

    try:
        # The message goes in as "incoming": guard decides whether it joins the conversation.
        turn = {"incoming": body.message, "steps": 0, "turn_failures": [], "turn_successes": 0}
        chunks = graph.astream(
            turn,
            config={"configurable": {"thread_id": thread_id(session, body.conversation_id)}},
            context=AgentContext(
                token=session.token,
                conversation_id=body.conversation_id,
                read_only=session.read_only,
            ),
            stream_mode="custom",
        )
        async for chunk in chunks:
            kind, data = chunk["type"], chunk["data"]
            if kind == "usage":
                usage["input_tokens"] += data["input_tokens"]
                usage["output_tokens"] += data["output_tokens"]
                continue
            follow(trace, kind, data, elapsed_ms)
            yield _sse(kind, data)
        yield _sse("done", {"usage": usage})
    except RetryableLLMError:
        logger.warning("LLM provider is rate limited")
        trace.outcome = "error"
        yield _sse("error", {"message": BUSY_REPLY})
    except Exception as exc:
        # Only the type: an exception message can carry customer text, and tracebacks are
        # not masked.
        logger.error("chat failed: %s", type(exc).__name__)
        trace.outcome = "error"
        yield _sse("error", {"message": ERROR_REPLY})
    finally:
        # After the last event, so the customer never waits for the trace.
        trace.latency_ms = elapsed_ms()
        trace.input_tokens = usage["input_tokens"]
        trace.output_tokens = usage["output_tokens"]
        trace.cost_usd = cost_of(
            trace.input_tokens,
            trace.output_tokens,
            settings.price_input_per_mtok,
            settings.price_output_per_mtok,
        )
        await tracer.record(trace)


def follow(trace: TurnTrace, kind: str, data: dict[str, Any], elapsed_ms: Any) -> None:
    """Builds the trace from the same events the browser gets."""
    match kind:
        case "token":
            if trace.first_token_ms is None:
                trace.first_token_ms = elapsed_ms()
            trace.reply_text += data["text"]
        case "tool_call":
            trace.tools.append({"name": data["name"], "started_ms": elapsed_ms()})
        case "tool_result":
            tool = trace.tools[-1]
            tool["duration_ms"] = elapsed_ms() - tool.pop("started_ms")
            tool["error"] = data["result"].get("error")
        case "guardrail":
            trace.outcome = "blocked"
        case "handoff":
            trace.outcome = "handoff"


def build_tracer(settings: Settings) -> tuple[Tracer, list[Any]]:
    """The sinks to open and close with the app."""
    sinks: list[Any] = []
    if settings.database_url.get_secret_value():
        sinks.append(PostgresTraceSink(settings.database_url.get_secret_value()))
    secret = settings.langfuse_secret_key.get_secret_value()
    if settings.langfuse_public_key and secret:
        sinks.append(
            LangfuseTraceSink(settings.langfuse_host, settings.langfuse_public_key, secret)
        )
    return Tracer(sinks), sinks


def create_app(
    settings: Settings | None = None,
    llm: LLMClient | None = None,
    order_api: OrderApiClient | None = None,
    policy_search: PolicySearch | None = None,
    tracer: Tracer | None = None,
    public_key: Ed25519PublicKey | None = None,
    checkpointer: BaseCheckpointSaver | None = None,
) -> FastAPI:
    install_log_masking()
    settings = settings or Settings()
    # The indexer shares Settings but verifies nothing, so the key is loaded here.
    public_key = public_key or load_public_key(settings.jwt_public_key_file)
    llm = llm or build_llm_client(settings)
    order_api = order_api or OrderApiClient(settings.order_api_url)
    policy_search = policy_search or PolicySearch(
        build_embedding_client(settings), PolicyStore(settings.database_url.get_secret_value())
    )

    sinks: list[Any] = []
    if tracer is None:
        tracer, sinks = build_tracer(settings)

    # Conversations live in Postgres when there is a database; tests run in memory.
    memory: PostgresMemory | None = None
    if checkpointer is None:
        database_url = settings.database_url.get_secret_value()
        if database_url:
            memory = PostgresMemory(database_url)
        else:
            checkpointer = InMemorySaver()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await policy_search.connect()
        cleanup = None
        if memory:
            app.state.graph = build_graph(llm, deps, await memory.open())
            cleanup = asyncio.create_task(memory.keep_pruned(settings.memory_retention_days))
        for sink in sinks:
            if hasattr(sink, "connect"):
                await sink.connect()
        yield
        if cleanup:
            cleanup.cancel()
        for sink in sinks:
            await sink.close()
        if memory:
            await memory.close()
        await policy_search.close()
        await order_api.close()

    app = FastAPI(title="DestekAI agent service", lifespan=lifespan)
    app.state.settings = settings
    app.state.public_key = public_key
    deps = ToolDeps(order_api=order_api, policy_search=policy_search)
    # With Postgres memory the graph is built at startup, once the saver exists.
    app.state.graph = build_graph(llm, deps, checkpointer) if checkpointer else None

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    # POST, not GET: the message and token stay out of URLs and access logs.
    limiter = ChatLimiter(settings.chat_limit_per_minute, settings.chat_limit_per_day)

    @app.post("/v1/chat")
    async def chat(
        body: ChatRequest, session: Annotated[Session, Depends(current_session)]
    ) -> EventSourceResponse:
        # An admin's view counts against the admin, not the customer being viewed.
        sender = f"admin:{session.admin_id}" if session.read_only else session.customer_id
        if not limiter.allow(sender):
            raise HTTPException(
                status_code=429, detail="rate_limited", headers={"Retry-After": "60"}
            )
        return EventSourceResponse(chat_events(app.state.graph, session, body, tracer, settings))

    return app
