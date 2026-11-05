"""An admin viewing a customer: the agent can inform but never act."""

import json
from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest

from app.auth import InvalidTokenError, issue_dev_token, verify_token
from app.prompts import READ_ONLY_ACTION_REPLY, READ_ONLY_NOTE
from tests.conftest import SECRET, FakeLLM, parse_sse, text, tool


def view_token(customer: str = "CUS-1001") -> str:
    return issue_dev_token(SECRET, customer, viewer="ADM-1001")


def raw(claims: dict) -> str:
    base = {"iss": "destekai", "sub": "CUS-1001", "exp": datetime.now(UTC) + timedelta(hours=1)}
    return jwt.encode(base | claims, SECRET, algorithm="HS256")


def test_view_token_carries_the_admin():
    claims = verify_token(SECRET, view_token())
    assert (claims.customer_id, claims.read_only, claims.admin_id) == (
        "CUS-1001",
        True,
        "ADM-1001",
    )


@pytest.mark.parametrize(
    "claims",
    [
        {"role": "admin", "sub": "ADM-1001"},  # admins use a view token instead
        {},  # no role
        {"role": "customer", "readonly": True},  # read-only without an admin
        {"role": "customer", "act": {"sub": "ADM-1001"}},  # an admin, but not read-only
        {"role": "customer", "readonly": True, "act": {}},
    ],
)
def test_tokens_outside_the_rules_are_refused(claims):
    with pytest.raises(InvalidTokenError):
        verify_token(SECRET, raw(claims))


async def test_write_tools_are_not_offered_and_the_prompt_says_why(harness):
    h = harness(FakeLLM(text("Merhaba")))
    await h.post_with_token(view_token(), "Siparişler?")

    offered = {spec["name"] for spec in h.llm.calls[0]["tools"]}
    assert "create_return_request" not in offered
    assert "escalate_to_human" not in offered
    assert "get_order_status" in offered
    assert READ_ONLY_NOTE.strip() in h.llm.calls[0]["system"]


async def test_a_forced_write_is_refused_before_the_order_api(harness, order_api):
    route = order_api.post("/v1/orders/DA-100001/returns").mock(
        return_value=httpx.Response(201, json={"id": "1"})
    )
    call = tool("create_return_request", {"order_id": "DA-100001", "reason": "test"})
    h = harness(FakeLLM(call, text("Yapamıyorum.")))
    events = parse_sse(await h.post_with_token(view_token(), "İade aç"))

    assert events[1][1]["result"]["error"] == "read_only_session"
    assert not route.called


async def test_asking_for_a_person_explains_instead_of_handing_off(harness, order_api):
    route = order_api.post("/v1/handoffs").mock(return_value=httpx.Response(201, json={}))
    h = harness(FakeLLM())
    events = parse_sse(await h.post_with_token(view_token(), "Temsilciye bağlan"))

    assert events[0] == ("token", {"text": READ_ONLY_ACTION_REPLY})
    assert not route.called
    assert h.llm.calls == []


async def test_the_admin_and_the_customer_never_share_a_conversation(harness):
    h = harness(FakeLLM(text("Tamam"), text("Merhaba"), text("Merhaba")))
    await h.post("Gizli notum: kapı kodu 1234", customer="CUS-1001", conversation="c1")
    await h.post_with_token(view_token(), "Önceki mesaj neydi?", conversation="c1")
    await h.post("Ben yine geldim", customer="CUS-1001", conversation="c1")

    admin_saw = json.dumps(h.llm.calls[1]["messages"], ensure_ascii=False)
    assert "kapı kodu" not in admin_saw
    customer_saw = json.dumps(h.llm.calls[2]["messages"], ensure_ascii=False)
    assert "Önceki mesaj neydi" not in customer_saw
