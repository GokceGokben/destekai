from typing import Any

import httpx

TIMEOUT = httpx.Timeout(10.0)


class OrderApiError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code)
        self.code = code
        self.message = message


class OrderApiClient:
    """Calls the order API as the customer: every request carries their own token, so
    ownership is decided there. This service has no privileged access to the data."""

    def __init__(self, base_url: str) -> None:
        self._http = httpx.AsyncClient(base_url=base_url, timeout=TIMEOUT)

    async def close(self) -> None:
        await self._http.aclose()

    async def list_orders(self, token: str) -> dict[str, Any]:
        return await self._request("GET", "/v1/orders", token)

    async def get_order(self, token: str, order_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/v1/orders/{order_id}", token)

    async def get_shipment(self, token: str, order_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/v1/orders/{order_id}/shipment", token)

    async def create_return(self, token: str, order_id: str, reason: str) -> dict[str, Any]:
        return await self._request(
            "POST", f"/v1/orders/{order_id}/returns", token, json={"reason": reason}
        )

    async def create_handoff(
        self, token: str, conversation_id: str, reason: str, summary: str
    ) -> dict[str, Any]:
        body = {"conversation_id": conversation_id, "reason": reason, "summary": summary}
        return await self._request("POST", "/v1/handoffs", token, json=body)

    async def _request(
        self, method: str, path: str, token: str, json: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        try:
            response = await self._http.request(
                method, path, json=json, headers={"Authorization": f"Bearer {token}"}
            )
        except httpx.HTTPError as exc:
            raise OrderApiError("order_api_unavailable", "order service is unreachable") from exc

        try:
            body = response.json()
        except ValueError as exc:
            raise OrderApiError("order_api_unavailable", "invalid order service reply") from exc

        if response.is_error:
            raise OrderApiError(
                body.get("code", "order_api_error"), body.get("message", "request failed")
            )
        return body
