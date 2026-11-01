"""The agent loop: agent -> tools -> agent, until the model stops calling tools."""

import json
import operator
from dataclasses import dataclass
from typing import Annotated, Literal, TypedDict

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.runtime import Runtime

from app.llm.base import LLMClient, Message, TextDelta, ToolCall, ToolCallRequested, Usage
from app.prompts import EMPTY_REPLY, STEP_LIMIT_REPLY, build_system_prompt
from app.tools import TOOL_SPECS, ToolDeps, execute_tool

# Model calls per customer message. Bounds cost if the model keeps calling tools.
MAX_STEPS = 6


@dataclass(frozen=True)
class AgentContext:
    """Per-run values. Unlike state and config, context is never checkpointed, which keeps
    the session token out of both the stored conversation and the model's messages."""

    token: str


class AgentState(TypedDict):
    messages: Annotated[list[Message], operator.add]
    steps: int


def build_graph(
    llm: LLMClient, deps: ToolDeps, checkpointer: BaseCheckpointSaver
) -> CompiledStateGraph:
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

        if not text and not tool_calls:
            text = EMPTY_REPLY
            runtime.stream_writer({"type": "token", "data": {"text": text}})

        message: Message = {"role": "assistant", "content": text}
        if tool_calls:
            message["tool_calls"] = tool_calls
        return {"messages": [message], "steps": state["steps"] + 1}

    async def tools(state: AgentState, runtime: Runtime[AgentContext]) -> dict:
        results: list[Message] = []
        # One at a time: a tool can have side effects, and events should read in order.
        for call in state["messages"][-1]["tool_calls"]:
            runtime.stream_writer(
                {"type": "tool_call", "data": {"name": call["name"], "args": call["args"]}}
            )
            result = await execute_tool(deps, runtime.context.token, call["name"], call["args"])
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
        return {"messages": results}

    async def give_up(state: AgentState, runtime: Runtime[AgentContext]) -> dict:
        runtime.stream_writer({"type": "token", "data": {"text": STEP_LIMIT_REPLY}})
        return {"messages": [{"role": "assistant", "content": STEP_LIMIT_REPLY}]}

    def after_agent(state: AgentState) -> Literal["tools", "__end__"]:
        return "tools" if state["messages"][-1].get("tool_calls") else END

    def after_tools(state: AgentState) -> Literal["agent", "give_up"]:
        return "give_up" if state["steps"] >= MAX_STEPS else "agent"

    graph = StateGraph(AgentState, context_schema=AgentContext)
    graph.add_node("agent", agent)
    graph.add_node("tools", tools)
    graph.add_node("give_up", give_up)
    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", after_agent)
    graph.add_conditional_edges("tools", after_tools)
    graph.add_edge("give_up", END)
    return graph.compile(checkpointer=checkpointer)
