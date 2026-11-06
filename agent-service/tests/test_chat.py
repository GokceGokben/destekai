import json

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.agent import MAX_STEPS
from app.llm.base import RetryableLLMError
from app.prompts import BUSY_REPLY, ERROR_REPLY, STEP_LIMIT_REPLY
from tests.conftest import FakeLLM, parse_sse, text, tool
from tests.tokens import make_token

ORDER = {
    "id": "DA-100001",
    "status": "delivered",
    "total_kurus": 239700,
    "placed_at": "2026-10-20T10:00:00Z",
    "delivered_at": "2026-10-23T10:00:00Z",
    "return_status": None,
    "items": [{"product_name": "Kulaklık", "quantity": 1, "unit_price_kurus": 239700}],
}


def names(events: list[tuple[str, dict]]) -> list[str]:
    return [name for name, _ in events]


async def test_plain_reply_streams_tokens_then_done(harness):
    h = harness(FakeLLM(text("Merhaba!")))
    response = await h.post("Selam")

    assert response.status_code == 200
    events = parse_sse(response)
    assert names(events) == ["token", "done"]
    assert events[0][1] == {"text": "Merhaba!"}
    assert events[1][1]["usage"] == {"input_tokens": 10, "output_tokens": 5}


async def test_tool_loop_emits_events_in_order_and_feeds_result_to_model(harness, order_api):
    order_api.get("/v1/orders/DA-100001").mock(return_value=httpx.Response(200, json=ORDER))
    h = harness(
        FakeLLM(tool("get_order_status", {"order_id": "DA-100001"}), text("Teslim edildi."))
    )
    events = parse_sse(await h.post("DA-100001 nerede?"))

    assert names(events) == ["tool_call", "tool_result", "token", "done"]
    assert events[0][1] == {"name": "get_order_status", "args": {"order_id": "DA-100001"}}
    assert events[1][1]["result"]["total"] == "2.397,00 TL"
    assert events[3][1]["usage"] == {"input_tokens": 20, "output_tokens": 10}

    tool_message = h.llm.calls[1]["messages"][-1]
    assert tool_message["role"] == "tool"
    assert tool_message["tool_call_id"] == "call-1"
    assert json.loads(tool_message["content"])["status"] == "delivered"


async def test_session_token_reaches_the_order_api_but_never_the_model(harness, order_api):
    route = order_api.get("/v1/orders").mock(
        return_value=httpx.Response(200, json={"orders": [ORDER]})
    )
    h = harness(FakeLLM(tool("list_my_orders"), text("Bir siparişiniz var.")))
    token = make_token("CUS-1001")
    await h.post_with_token(token, "Siparişlerim?")

    assert route.calls.last.request.headers["Authorization"] == f"Bearer {token}"
    assert token not in json.dumps(h.llm.calls, ensure_ascii=False)
    assert "CUS-1001" not in json.dumps(h.llm.calls, ensure_ascii=False)

    config = {"configurable": {"thread_id": "CUS-1001:c1"}}
    assert token not in repr(await h.app.state.graph.aget_state(config))
    assert token not in repr(h.app.state.graph.checkpointer.storage)


async def test_no_tool_accepts_an_identity_parameter(harness):
    h = harness(FakeLLM(text("Merhaba!")))
    await h.post("Selam")

    schemas = json.dumps(h.llm.calls[0]["tools"]).lower()
    assert "customer" not in [
        word for spec in h.llm.calls[0]["tools"] for word in spec["parameters"]["properties"]
    ]
    for forbidden in ("customer_id", "token", "authorization"):
        assert forbidden not in schemas


async def test_order_api_rejection_becomes_a_tool_result(harness, order_api):
    order_api.get("/v1/orders/DA-100004").mock(
        return_value=httpx.Response(
            404, json={"code": "order_not_found", "message": "order not found"}
        )
    )
    h = harness(FakeLLM(tool("get_order_status", {"order_id": "DA-100004"}), text("Bulunamadı.")))
    events = parse_sse(await h.post("DA-100004 kimin?"))

    assert events[1][1]["result"]["error"] == "order_not_found"
    assert names(events)[-1] == "done"


async def test_path_traversal_in_order_id_never_reaches_the_api(harness, order_api):
    h = harness(
        FakeLLM(tool("get_order_status", {"order_id": "../../admin"}), text("Geçersiz numara."))
    )
    events = parse_sse(await h.post("../../admin"))

    assert events[1][1]["result"]["error"] == "invalid_argument"
    assert not order_api.calls


async def test_unknown_tool_is_reported_to_the_model(harness):
    h = harness(FakeLLM(tool("delete_all_orders"), text("Bunu yapamam.")))
    events = parse_sse(await h.post("Hepsini sil"))
    assert events[1][1]["result"]["error"] == "unknown_tool"


async def test_step_limit_stops_a_looping_model(harness, order_api):
    route = order_api.get("/v1/orders").mock(return_value=httpx.Response(200, json={"orders": []}))
    h = harness(FakeLLM(*[tool("list_my_orders") for _ in range(MAX_STEPS + 5)]))
    events = parse_sse(await h.post("Siparişlerim?"))

    assert len(h.llm.calls) == MAX_STEPS
    assert route.call_count == MAX_STEPS
    assert ("token", {"text": STEP_LIMIT_REPLY}) in events
    assert names(events)[-1] == "done"


async def test_step_budget_resets_for_each_customer_message(harness, order_api):
    order_api.get("/v1/orders").mock(return_value=httpx.Response(200, json={"orders": []}))
    first = [tool("list_my_orders") for _ in range(MAX_STEPS)]
    h = harness(FakeLLM(*first, text("Yeni yanıt")))

    await h.post("bir")
    events = parse_sse(await h.post("iki"))
    assert ("token", {"text": "Yeni yanıt"}) in events


async def test_conversation_memory_is_kept_between_messages(harness):
    h = harness(FakeLLM(text("Merhaba Ayşe"), text("Ayşe demiştiniz")))
    await h.post("Adım Ayşe")
    await h.post("Adım neydi?")

    contents = [message["content"] for message in h.llm.calls[1]["messages"]]
    assert contents == ["Adım Ayşe", "Merhaba Ayşe", "Adım neydi?"]


async def test_other_customer_cannot_read_a_conversation_by_its_id(harness):
    h = harness(FakeLLM(text("Tamam"), text("Merhaba")))
    await h.post("Gizli bilgim var", customer="CUS-1001", conversation="shared")
    await h.post("Önceki mesaj neydi?", customer="CUS-1002", conversation="shared")

    contents = [message["content"] for message in h.llm.calls[1]["messages"]]
    assert contents == ["Önceki mesaj neydi?"]


async def test_rate_limit_becomes_a_turkish_error_event(harness):
    h = harness(FakeLLM(RetryableLLMError()))
    events = parse_sse(await h.post("Selam"))
    assert events == [("error", {"message": BUSY_REPLY})]


async def test_unexpected_failure_hides_details(harness):
    h = harness(FakeLLM(RuntimeError("secret internal detail")))
    response = await h.post("Selam")

    assert parse_sse(response) == [("error", {"message": ERROR_REPLY})]
    assert "secret internal detail" not in response.text


async def test_chat_requires_a_valid_token(harness):
    h = harness(FakeLLM())
    forged = make_token("CUS-1001", key=Ed25519PrivateKey.generate())
    response = await h.post_with_token(forged, "Selam")

    assert response.status_code == 401
    assert h.llm.calls == []


async def test_malformed_conversation_id_is_rejected(harness):
    h = harness(FakeLLM())
    response = await h.post("Selam", conversation="CUS-1002:c1")
    assert response.status_code == 422
