"""The agent's tools.

No tool takes a customer ID or a token: those parameters do not exist for the LLM. The
session token is passed in by the graph, out of the model's reach.
"""

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.llm.base import ToolSpec
from app.order_api import OrderApiClient, OrderApiError
from app.rag.search import PolicySearch, PolicySearchError

ORDER_ID_PATTERN = re.compile(r"DA-[0-9]{6}")
ORDER_ID_SCHEMA = {"type": "string", "description": "Order number, e.g. DA-100001"}


class InvalidArgument(Exception):
    pass


@dataclass(frozen=True)
class ToolDeps:
    order_api: OrderApiClient
    policy_search: PolicySearch


ToolRunner = Callable[[ToolDeps, str, dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class Tool:
    spec: ToolSpec
    run: ToolRunner


def _order_id(args: dict[str, Any]) -> str:
    """LLM output ends up in a URL path, so "../" and the like must never get through."""
    value = args.get("order_id")
    order_id = value.strip().upper() if isinstance(value, str) else ""
    if not ORDER_ID_PATTERN.fullmatch(order_id):
        raise InvalidArgument("order_id must look like DA-100001")
    return order_id


def format_try(kurus: int) -> str:
    """Formats kuruş as Turkish lira, e.g. 239700 -> 2.397,00 TL."""
    grouped = f"{kurus // 100:,}".replace(",", ".")
    return f"{grouped},{kurus % 100:02d} TL"


def _with_prices(order: dict[str, Any]) -> dict[str, Any]:
    """Adds ready-made prices so that the model does not have to do arithmetic."""
    items = [
        {**item, "unit_price": format_try(item["unit_price_kurus"])} for item in order["items"]
    ]
    return {**order, "items": items, "total": format_try(order["total_kurus"])}


async def _list_my_orders(deps: ToolDeps, token: str, args: dict[str, Any]) -> dict[str, Any]:
    result = await deps.order_api.list_orders(token)
    return {"orders": [_with_prices(order) for order in result["orders"]]}


async def _get_order_status(deps: ToolDeps, token: str, args: dict[str, Any]) -> dict[str, Any]:
    return _with_prices(await deps.order_api.get_order(token, _order_id(args)))


async def _track_shipment(deps: ToolDeps, token: str, args: dict[str, Any]) -> dict[str, Any]:
    return await deps.order_api.get_shipment(token, _order_id(args))


async def _create_return_request(
    deps: ToolDeps, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    order_id = _order_id(args)
    reason = args.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise InvalidArgument("reason is required")
    return await deps.order_api.create_return(token, order_id, reason)


async def _search_policy(deps: ToolDeps, token: str, args: dict[str, Any]) -> dict[str, Any]:
    """Policies are public, so the token is deliberately unused."""
    query = args.get("query")
    if not isinstance(query, str) or not query.strip():
        raise InvalidArgument("query is required")
    return {"results": await deps.policy_search.search(query)}


TOOLS = {
    tool.spec["name"]: tool
    for tool in [
        Tool(
            {
                "name": "list_my_orders",
                "description": "List the current customer's most recent orders.",
                "parameters": {"type": "object", "properties": {}},
            },
            _list_my_orders,
        ),
        Tool(
            {
                "name": "get_order_status",
                "description": "Get the status, items and total of one of the customer's orders.",
                "parameters": {
                    "type": "object",
                    "properties": {"order_id": ORDER_ID_SCHEMA},
                    "required": ["order_id"],
                },
            },
            _get_order_status,
        ),
        Tool(
            {
                "name": "track_shipment",
                "description": "Get the carrier, tracking number and delivery events of an order.",
                "parameters": {
                    "type": "object",
                    "properties": {"order_id": ORDER_ID_SCHEMA},
                    "required": ["order_id"],
                },
            },
            _track_shipment,
        ),
        Tool(
            {
                "name": "create_return_request",
                "description": (
                    "Open a return for a delivered order. Call only after the customer has "
                    "stated a reason and confirmed that they want the return."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "order_id": ORDER_ID_SCHEMA,
                        "reason": {
                            "type": "string",
                            "description": "The return reason in the customer's own words",
                        },
                    },
                    "required": ["order_id", "reason"],
                },
            },
            _create_return_request,
        ),
        Tool(
            {
                "name": "search_policy",
                "description": (
                    "Search the store's return, shipping, warranty and payment policies. "
                    "An empty result means the policies do not cover the question."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "A short question in Turkish",
                        },
                    },
                    "required": ["query"],
                },
            },
            _search_policy,
        ),
    ]
}

# Handing off ends the turn and changes the conversation's state, so the graph runs it
# itself instead of execute_tool; the model only sees its spec.
ESCALATE_TOOL = "escalate_to_human"
ESCALATE_SPEC: ToolSpec = {
    "name": ESCALATE_TOOL,
    "description": (
        "Hand the conversation to a human support agent. Call it when the customer asks for "
        "a person, or when the other tools cannot resolve the request. This ends your part "
        "of the conversation."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": (
                    "For the human agent, in Turkish: what the customer wants, which order it "
                    "is about and what was already tried. No phone or ID numbers."
                ),
            },
        },
        "required": ["summary"],
    },
}

TOOL_SPECS = [tool.spec for tool in TOOLS.values()] + [ESCALATE_SPEC]
# Tools that change something. A read-only session is not offered them, and execute_tool
# refuses them; the order API refuses the request as well.
WRITE_TOOLS = {"create_return_request", ESCALATE_TOOL}
READ_ONLY_TOOL_SPECS = [spec for spec in TOOL_SPECS if spec["name"] not in WRITE_TOOLS]

# Answers about the order, not failures: "not shipped yet" or "too late to return" is what
# the customer needed to know. Every other error code counts towards a handoff.
OUTCOME_ERRORS = {
    "read_only_session",
    "shipment_not_found",
    "order_not_delivered",
    "return_window_expired",
    "return_already_exists",
}


def failure_of(name: str, result: dict[str, Any]) -> str | None:
    """Describes a tool result that did not help the customer, or returns None."""
    error = result.get("error")
    if error and error not in OUTCOME_ERRORS:
        return f"{name}: {error}"
    if name == "search_policy" and not result.get("results"):
        return "search_policy: sonuç yok"
    return None


async def execute_tool(
    deps: ToolDeps, token: str, name: str, args: dict[str, Any], read_only: bool = False
) -> dict[str, Any]:
    """Failures come back as data, which lets the model explain them to the customer."""
    if read_only and name in WRITE_TOOLS:
        return {"error": "read_only_session", "message": "this view cannot change anything"}
    tool = TOOLS.get(name)
    if tool is None:
        return {"error": "unknown_tool", "message": f"no tool named {name}"}
    try:
        return await tool.run(deps, token, args)
    except InvalidArgument as exc:
        return {"error": "invalid_argument", "message": str(exc)}
    except OrderApiError as exc:
        return {"error": exc.code, "message": exc.message}
    except PolicySearchError:
        return {"error": "policy_search_unavailable", "message": "policy search failed"}
