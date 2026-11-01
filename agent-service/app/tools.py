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

ORDER_ID_PATTERN = re.compile(r"DA-[0-9]{6}")
ORDER_ID_SCHEMA = {"type": "string", "description": "Order number, e.g. DA-100001"}


class InvalidArgument(Exception):
    pass


ToolRunner = Callable[[OrderApiClient, str, dict[str, Any]], Awaitable[dict[str, Any]]]


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


async def _list_my_orders(api: OrderApiClient, token: str, args: dict[str, Any]) -> dict[str, Any]:
    result = await api.list_orders(token)
    return {"orders": [_with_prices(order) for order in result["orders"]]}


async def _get_order_status(
    api: OrderApiClient, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    return _with_prices(await api.get_order(token, _order_id(args)))


async def _track_shipment(api: OrderApiClient, token: str, args: dict[str, Any]) -> dict[str, Any]:
    return await api.get_shipment(token, _order_id(args))


async def _create_return_request(
    api: OrderApiClient, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    order_id = _order_id(args)
    reason = args.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise InvalidArgument("reason is required")
    return await api.create_return(token, order_id, reason)


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
    ]
}

TOOL_SPECS = [tool.spec for tool in TOOLS.values()]


async def execute_tool(
    api: OrderApiClient, token: str, name: str, args: dict[str, Any]
) -> dict[str, Any]:
    """Failures come back as data, which lets the model explain them to the customer."""
    tool = TOOLS.get(name)
    if tool is None:
        return {"error": "unknown_tool", "message": f"no tool named {name}"}
    try:
        return await tool.run(api, token, args)
    except InvalidArgument as exc:
        return {"error": "invalid_argument", "message": str(exc)}
    except OrderApiError as exc:
        return {"error": exc.code, "message": exc.message}
