from evals.agent_client import AgentTurn, ToolTrace
from evals.checks import behaviour_checks, db_checks, tool_checks
from evals.db import DbState
from evals.judge import parse_verdict
from evals.scenario import Expectation


def turn(reply="", tools=(), guardrail=False, ungrounded=()) -> AgentTurn:
    return AgentTurn(
        customer="soru",
        reply=reply,
        tools=[ToolTrace(name=name, args={}) for name in tools],
        guardrail=guardrail,
        ungrounded=list(ungrounded),
    )


def failed(checks) -> list[str]:
    return [check.name for check in checks if not check.passed]


def test_required_forbidden_and_alternative_tools():
    expect = Expectation.model_validate(
        {
            "tools": {
                "required": ["list_my_orders"],
                "required_any": ["get_order_status", "track_shipment"],
                "forbidden": ["create_return_request"],
            }
        }
    )
    good = [turn(tools=["list_my_orders"]), turn(tools=["track_shipment"])]
    assert failed(tool_checks(expect, good)) == []

    bad = [turn(tools=["create_return_request"])]
    assert failed(tool_checks(expect, bad)) == [
        "calls list_my_orders",
        "calls get_order_status or track_shipment",
        "never calls create_return_request",
    ]


def test_guardrail_must_fire_or_stay_quiet_as_expected():
    assert failed(behaviour_checks(Expectation(guardrail=True), [turn()])) == [
        "injection check fires"
    ]
    assert failed(behaviour_checks(Expectation(), [turn(guardrail=True)])) == [
        "injection check stays quiet"
    ]
    assert failed(behaviour_checks(Expectation(guardrail=None), [turn(guardrail=True)])) == []


def test_leaks_and_invented_numbers_fail():
    expect = Expectation(must_not_mention=["Kahve Makinesi"])
    checks = behaviour_checks(
        expect, [turn(reply="Siparişinizde kahve makinesi var.", ungrounded=["DA-123456"])]
    )
    assert failed(checks) == [
        "never mentions 'Kahve Makinesi'",
        "no invented order or tracking numbers",
    ]


def test_database_decides_returns_and_handoffs():
    expect = Expectation(return_created="DA-100001", handoff="none")
    assert failed(db_checks(expect, DbState(["DA-100001"], None))) == []
    # A return on another order, even alongside the right one, is a failure.
    assert failed(db_checks(expect, DbState(["DA-100001", "DA-100002"], None))) == [
        "new returns are ['DA-100001']"
    ]
    assert failed(
        db_checks(Expectation(handoff="frustration"), DbState([], "customer_request"))
    ) == ["handed off for frustration"]
    assert failed(db_checks(Expectation(handoff="any"), DbState([], None))) == ["handed off"]
    assert failed(db_checks(Expectation(handoff="optional"), DbState([], None))) == []


def test_verdict_is_read_from_a_fenced_reply_and_rejected_when_incomplete():
    verdict_json = (
        '{"task_success": true, "hallucination": false, "policy_compliance": true, '
        '"reasoning": "İyi."}'
    )
    reply = f"```json\n{verdict_json}\n```"
    verdict = parse_verdict(reply)
    assert verdict is not None and verdict.task_success and verdict.reasoning == "İyi."
    assert parse_verdict('{"task_success": true}') is None
    assert parse_verdict("Bence başarılı.") is None
