"""The agent graph.

guard -> agent <-> tools -> review, with handoff reachable from guard, tools and review.

guard checks the customer's message before the model sees it; review looks at the finished
turn. Both decide by rules, not by asking the model, so a customer cannot argue them out of a
handoff or past a blocked message.
"""

import json
import logging
import operator
import re
from dataclasses import dataclass
from typing import Annotated, Any, Literal, NotRequired, TypedDict

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.runtime import Runtime
from langgraph.types import Command

from app.guardrails.escalation import (
    FRUSTRATION_STREAK,
    FRUSTRATION_THRESHOLD,
    MAX_FAILED_TURNS,
    SUMMARY_LIMIT,
    build_summary,
    frustration_score,
    wants_human,
)
from app.guardrails.injection import detect_injection
from app.guardrails.pii import mask_pii
from app.llm.base import LLMClient, Message, TextDelta, ToolCall, ToolCallRequested, Usage
from app.order_api import OrderApiError
from app.prompts import (
    BLOCKED_MESSAGE,
    EMPTY_REPLY,
    HANDED_OFF_REPLY,
    HANDOFF_FAILED_REPLY,
    HANDOFF_REPLY,
    INJECTION_REPLY,
    STEP_LIMIT_REPLY,
    build_system_prompt,
)
from app.tools import ESCALATE_TOOL, TOOL_SPECS, ToolDeps, execute_tool, failure_of

logger = logging.getLogger(__name__)

# Model calls per customer message. Bounds cost if the model keeps calling tools.
MAX_STEPS = 6

# Order numbers and tracking codes, the facts a reply must not invent.
REFERENCE_PATTERN = re.compile(r"\bDA-\d{6}\b|\b[A-Z]{2,5}\d{6,}\b")

HandoffReason = Literal["customer_request", "repeated_failures", "frustration", "agent_decision"]


@dataclass(frozen=True)
class AgentContext:
    """Per-run values. Unlike state and config, context is never checkpointed, which keeps
    the session token out of both the stored conversation and the model's messages."""

    token: str
    conversation_id: str


class PendingHandoff(TypedDict):
    reason: HandoffReason
    summary: str | None


class AgentState(TypedDict):
    messages: Annotated[list[Message], operator.add]
    # Set for each customer message.
    incoming: str
    steps: int
    turn_failures: list[str]
    turn_successes: int
    # Kept across the conversation.
    failed_turns: NotRequired[int]
    last_frustration: NotRequired[int]
    handed_off: NotRequired[bool]
    pending_handoff: NotRequired[PendingHandoff | None]


def _say(runtime: Runtime[AgentContext], text: str) -> Message:
    runtime.stream_writer({"type": "token", "data": {"text": text}})
    return {"role": "assistant", "content": text}


def unknown_references(messages: list[Message]) -> list[str]:
    """Order numbers and tracking codes in the last reply that neither a tool result nor the
    customer mentioned: the model made them up."""
    known: set[str] = set()
    for message in messages[:-1]:
        if message["role"] in ("tool", "user"):
            known.update(REFERENCE_PATTERN.findall(message["content"]))
    return sorted(set(REFERENCE_PATTERN.findall(messages[-1]["content"])) - known)


def build_graph(
    llm: LLMClient, deps: ToolDeps, checkpointer: BaseCheckpointSaver
) -> CompiledStateGraph:
    async def guard(
        state: AgentState, runtime: Runtime[AgentContext]
    ) -> Command[Literal["agent", "review", "handoff", "__end__"]]:
        text = state["incoming"]
        user: Message = {"role": "user", "content": text}

        if state.get("handed_off"):
            return Command(update={"messages": [user, _say(runtime, HANDED_OFF_REPLY)]}, goto=END)

        rule = detect_injection(text)
        if rule:
            logger.warning("prompt injection blocked: rule=%s", rule)
            runtime.stream_writer({"type": "guardrail", "data": {"kind": "prompt_injection"}})
            blocked: Message = {"role": "user", "content": BLOCKED_MESSAGE}
            return Command(
                update={
                    "messages": [blocked, _say(runtime, INJECTION_REPLY)],
                    "turn_failures": ["prompt_injection"],
                },
                goto="review",
            )

        if wants_human(text):
            pending: PendingHandoff = {"reason": "customer_request", "summary": None}
            return Command(update={"messages": [user], "pending_handoff": pending}, goto="handoff")

        score = frustration_score(text)
        previous = state.get("last_frustration", 0)
        update: dict[str, Any] = {"messages": [user], "last_frustration": score}
        if score >= FRUSTRATION_THRESHOLD or min(score, previous) >= FRUSTRATION_STREAK:
            update["pending_handoff"] = {"reason": "frustration", "summary": None}
            return Command(update=update, goto="handoff")
        return Command(update=update, goto="agent")

    async def agent(state: AgentState, runtime: Runtime[AgentContext]) -> dict:
        text = ""
        tool_calls: list[ToolCall] = []
        stream = llm.stream(build_system_prompt(), state["messages"], TOOL_SPECS)
        async for event in stream:
            match event:
                case TextDelta(delta):
                    text += delta
                    runtime.stream_writer({"type": "token", "data": {"text": delta}})
                case ToolCallRequested(call):
                    tool_calls.append(call)
                case Usage(input_tokens, output_tokens):
                    runtime.stream_writer(
                        {
                            "type": "usage",
                            "data": {"input_tokens": input_tokens, "output_tokens": output_tokens},
                        }
                    )

        update: dict[str, Any] = {"steps": state["steps"] + 1}
        if not text and not tool_calls:
            text = EMPTY_REPLY
            runtime.stream_writer({"type": "token", "data": {"text": text}})
            update["turn_failures"] = [*state["turn_failures"], "empty_reply"]

        message: Message = {"role": "assistant", "content": text}
        if tool_calls:
            message["tool_calls"] = tool_calls
        return {**update, "messages": [message]}

    async def tools(state: AgentState, runtime: Runtime[AgentContext]) -> dict:
        results: list[Message] = []
        failures = list(state["turn_failures"])
        successes = state["turn_successes"]
        pending: PendingHandoff | None = None
        # One at a time: a tool can have side effects, and events should read in order.
        for call in state["messages"][-1]["tool_calls"]:
            runtime.stream_writer(
                {"type": "tool_call", "data": {"name": call["name"], "args": call["args"]}}
            )
            if call["name"] == ESCALATE_TOOL:
                summary = call["args"].get("summary")
                pending = {
                    "reason": "agent_decision",
                    "summary": summary if isinstance(summary, str) else None,
                }
                # Every call needs a reply in the history, or the next request is invalid.
                result: dict[str, Any] = {"status": "handing_off"}
            else:
                result = await execute_tool(deps, runtime.context.token, call["name"], call["args"])
                failure = failure_of(call["name"], result)
                if failure:
                    failures.append(failure)
                else:
                    successes += 1
            runtime.stream_writer(
                {"type": "tool_result", "data": {"name": call["name"], "result": result}}
            )
            results.append(
                {
                    "role": "tool",
                    "content": json.dumps(result, ensure_ascii=False),
                    "tool_call_id": call["id"],
                    "tool_name": call["name"],
                }
            )
        return {
            "messages": results,
            "turn_failures": failures,
            "turn_successes": successes,
            "pending_handoff": pending,
        }

    async def give_up(state: AgentState, runtime: Runtime[AgentContext]) -> dict:
        return {
            "messages": [_say(runtime, STEP_LIMIT_REPLY)],
            "turn_failures": [*state["turn_failures"], "step_limit"],
        }

    async def review(
        state: AgentState, runtime: Runtime[AgentContext]
    ) -> Command[Literal["handoff", "__end__"]]:
        failures = list(state["turn_failures"])
        invented = unknown_references(state["messages"])
        if invented:
            # The reply has already streamed; this records it and counts it as a failure.
            logger.warning("reply mentions unknown references: %s", invented)
            runtime.stream_writer({"type": "grounding_violation", "data": {"references": invented}})
            failures.append("ungrounded_reply")

        # A turn that helped resets the count, so the limit is about failures in a row.
        failed_turns = state.get("failed_turns", 0)
        if failures:
            failed_turns += 1
        elif state["turn_successes"]:
            failed_turns = 0

        update: dict[str, Any] = {"failed_turns": failed_turns, "turn_failures": failures}
        if failed_turns >= MAX_FAILED_TURNS:
            update["pending_handoff"] = {"reason": "repeated_failures", "summary": None}
            return Command(update=update, goto="handoff")
        return Command(update=update, goto=END)

    async def handoff(state: AgentState, runtime: Runtime[AgentContext]) -> dict:
        pending = state.get("pending_handoff")
        assert pending is not None
        reason = pending["reason"]
        if pending["summary"] and pending["summary"].strip():
            summary = mask_pii(pending["summary"].strip())[:SUMMARY_LIMIT]
        else:
            customer = [m["content"] for m in state["messages"] if m["role"] == "user"]
            summary = build_summary(reason, customer, state["turn_failures"])

        context = runtime.context
        try:
            await deps.order_api.create_handoff(
                context.token, context.conversation_id, reason, summary
            )
        except OrderApiError as exc:
            logger.error("handoff failed: %s", exc.code)
            return {"messages": [_say(runtime, HANDOFF_FAILED_REPLY)], "pending_handoff": None}

        logger.info("conversation handed off: reason=%s", reason)
        runtime.stream_writer({"type": "handoff", "data": {"reason": reason, "summary": summary}})
        return {
            "messages": [_say(runtime, HANDOFF_REPLY)],
            "handed_off": True,
            "pending_handoff": None,
        }

    def after_agent(state: AgentState) -> Literal["tools", "review"]:
        return "tools" if state["messages"][-1].get("tool_calls") else "review"

    def after_tools(state: AgentState) -> Literal["agent", "give_up", "handoff"]:
        if state.get("pending_handoff"):
            return "handoff"
        return "give_up" if state["steps"] >= MAX_STEPS else "agent"

    graph = StateGraph(AgentState, context_schema=AgentContext)
    graph.add_node("guard", guard)
    graph.add_node("agent", agent)
    graph.add_node("tools", tools)
    graph.add_node("give_up", give_up)
    graph.add_node("review", review)
    graph.add_node("handoff", handoff)
    graph.add_edge(START, "guard")
    graph.add_conditional_edges("agent", after_agent)
    graph.add_conditional_edges("tools", after_tools)
    graph.add_edge("give_up", "review")
    graph.add_edge("handoff", END)
    return graph.compile(checkpointer=checkpointer)
