"""The runner and report, with a fake agent endpoint, database and models."""

import json
from datetime import datetime

import httpx
import pytest
import respx
from app.llm.base import TextDelta, Usage

from evals.db import DbState
from evals.judge import Judge
from evals.llm import TextModel
from evals.report import build_report, render_markdown, summarize, write_report
from evals.runner import RateLimited, Runner
from evals.scenario import Scenario

AGENT = "http://agent.test"
SECRET = "test-secret-test-secret-test-secret"
GOOD_VERDICT = json.dumps(
    {"task_success": True, "hallucination": False, "policy_compliance": True, "reasoning": "Tamam."}
)


def sse(*events: tuple[str, dict]) -> httpx.Response:
    body = "".join(
        f"event: {name}\r\ndata: {json.dumps(data, ensure_ascii=False)}\r\n\r\n"
        for name, data in events
    )
    return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})


def reply(text: str, *extra: tuple[str, dict]) -> httpx.Response:
    usage = {"usage": {"input_tokens": 100, "output_tokens": 20}}
    return sse(*extra, ("token", {"text": text}), ("done", usage))


class FakeClient:
    def __init__(self, *replies: str) -> None:
        self.replies = list(replies)

    async def stream(self, system, messages, tools):
        yield TextDelta(self.replies.pop(0))
        yield Usage(50, 10)


class FakeDb:
    def __init__(self, state: DbState) -> None:
        self._state = state

    async def reset(self) -> datetime:
        return datetime.now()

    async def state(self, customer_id, conversation_id, since) -> DbState:
        return self._state


def scenario(**overrides) -> Scenario:
    data = {
        "id": "test-scenario",
        "category": "order_status",
        "customer_id": "CUS-1001",
        "persona": "Ayşe",
        "goal": "Siparişini öğrenmek",
        "opening_message": "DA-100002 nerede?",
        "success_criteria": "Durumu söyler.",
        "expect": {"tools": {"required": ["get_order_status"]}},
    }
    return Scenario.model_validate(data | overrides)


def runner(simulator: list[str], judge: list[str], state: DbState | None = None) -> Runner:
    return Runner(
        db=FakeDb(state or DbState([], None)),  # type: ignore[arg-type]
        agent_url=AGENT,
        jwt_secret=SECRET,
        simulator_model=TextModel(FakeClient(*simulator)),
        judge=Judge(TextModel(FakeClient(*judge))),
    )


@respx.mock(base_url=AGENT)
async def test_a_conversation_ends_when_the_customer_is_done(respx_mock):
    tool_events = (
        ("tool_call", {"name": "get_order_status", "args": {"order_id": "DA-100002"}}),
        ("tool_result", {"name": "get_order_status", "result": {"status": "shipped"}}),
    )
    route = respx_mock.post("/v1/chat").mock(
        side_effect=[reply("Kargoda.", *tool_events), reply("Rica ederim.")]
    )
    result = await runner(["Teşekkürler", "[BİTTİ]"], [GOOD_VERDICT]).run(scenario())

    assert route.call_count == 2
    assert result.ended_by == "simulator"
    assert [t.customer for t in result.turns] == ["DA-100002 nerede?", "Teşekkürler"]
    assert result.turns[0].tools[0].result == {"status": "shipped"}
    assert result.success
    # Every message of the run uses the same conversation.
    ids = {json.loads(call.request.content)["conversation_id"] for call in route.calls}
    assert ids == {result.conversation_id}


@respx.mock(base_url=AGENT)
async def test_a_handoff_ends_the_conversation(respx_mock):
    respx_mock.post("/v1/chat").mock(
        return_value=reply("Aktarıyorum.", ("handoff", {"reason": "frustration", "summary": "x"}))
    )
    run = runner([], [GOOD_VERDICT], DbState([], "frustration"))
    result = await run.run(scenario(expect={"handoff": "frustration"}))

    assert result.ended_by == "handoff"
    assert len(result.turns) == 1
    assert result.success


@respx.mock(base_url=AGENT)
async def test_the_turn_limit_ends_the_conversation(respx_mock):
    respx_mock.post("/v1/chat").mock(return_value=reply("Tekrar sorar mısınız?"))
    result = await runner(["Yine soruyorum"], [GOOD_VERDICT]).run(scenario(max_turns=2))

    assert result.ended_by == "max_turns"
    assert len(result.turns) == 2
    # The required tool was never called, so the checks fail whatever the judge says.
    assert not result.success


@respx.mock(base_url=AGENT)
async def test_a_rate_limited_agent_stops_the_run(respx_mock):
    busy = sse(
        (
            "error",
            {"message": "Şu anda yoğunluk yaşıyoruz. Lütfen birkaç dakika sonra tekrar deneyin."},
        )
    )
    respx_mock.post("/v1/chat").mock(return_value=busy)
    with pytest.raises(RateLimited):
        await runner([], []).run(scenario())


@respx.mock(base_url=AGENT)
async def test_an_unusable_verdict_is_recorded_as_unjudged(respx_mock):
    respx_mock.post("/v1/chat").mock(return_value=reply("Kargoda."))
    result = await runner(["[BİTTİ]"], ["Bence iyi.", "Hâlâ JSON yok."]).run(scenario())

    assert result.verdict is None
    assert not result.success


@respx.mock(base_url=AGENT)
async def test_report_metrics_and_files(respx_mock, tmp_path):
    respx_mock.post("/v1/chat").mock(return_value=reply("Kargoda."))
    bad_verdict = GOOD_VERDICT.replace('"hallucination": false', '"hallucination": true')
    good = await runner(["[BİTTİ]"], [GOOD_VERDICT]).run(scenario(expect={}))
    bad = await runner(["[BİTTİ]"], [bad_verdict]).run(
        scenario(id="attack", category="injection", expect={})
    )

    summary = summarize([good, bad], price_input=0.3, price_output=2.5)
    assert summary["finished"] == 2
    assert summary["hallucination_rate"] == 0.5
    assert summary["adversarial_pass_rate"] == 1.0
    assert summary["avg_input_tokens"] == 100
    assert summary["avg_cost_usd"] == pytest.approx(100 * 0.3 / 1e6 + 20 * 2.5 / 1e6)

    report = build_report(
        [good, bad], "test-run", {"agent": "a", "simulator": "s", "judge": "j"}, {}
    )
    markdown = render_markdown(report)
    assert "| test-scenario | order_status | ✅ |" in markdown
    write_report(report, tmp_path)
    assert (
        json.loads((tmp_path / "latest.json").read_text(encoding="utf-8"))["run_id"] == "test-run"
    )
    assert (tmp_path / "test-run.md").exists()


def test_an_interrupted_run_leaves_the_latest_report_alone(tmp_path):
    (tmp_path / "latest.json").write_text('{"run_id": "previous"}', encoding="utf-8")
    report = build_report([], "interrupted", {"agent": "a", "simulator": "s", "judge": "j"}, {})
    write_report(report, tmp_path, update_latest=False)

    assert (
        json.loads((tmp_path / "latest.json").read_text(encoding="utf-8"))["run_id"] == "previous"
    )
    assert (tmp_path / "interrupted.json").exists()
