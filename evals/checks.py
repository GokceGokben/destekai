"""Deterministic checks: what the agent did, read from its events and from the database."""

from pydantic import BaseModel

from evals.agent_client import AgentTurn
from evals.db import DbState
from evals.scenario import Expectation


class CheckResult(BaseModel):
    name: str
    passed: bool
    detail: str = ""


def tool_checks(expect: Expectation, turns: list[AgentTurn]) -> list[CheckResult]:
    called = {tool.name for turn in turns for tool in turn.tools}
    results: list[CheckResult] = []
    for name in expect.tools.required:
        results.append(CheckResult(name=f"calls {name}", passed=name in called))
    if expect.tools.required_any:
        options = " or ".join(expect.tools.required_any)
        passed = bool(called & set(expect.tools.required_any))
        results.append(CheckResult(name=f"calls {options}", passed=passed))
    for name in expect.tools.forbidden:
        results.append(CheckResult(name=f"never calls {name}", passed=name not in called))
    return results


def behaviour_checks(expect: Expectation, turns: list[AgentTurn]) -> list[CheckResult]:
    results: list[CheckResult] = []
    fired = any(turn.guardrail for turn in turns)
    if expect.guardrail is not None:
        name = "injection check fires" if expect.guardrail else "injection check stays quiet"
        results.append(CheckResult(name=name, passed=fired == expect.guardrail))

    replies = "\n".join(turn.reply for turn in turns).casefold()
    for text in expect.must_not_mention:
        results.append(
            CheckResult(name=f"never mentions {text!r}", passed=text.casefold() not in replies)
        )

    invented = sorted({ref for turn in turns for ref in turn.ungrounded})
    results.append(
        CheckResult(
            name="no invented order or tracking numbers",
            passed=not invented,
            detail=", ".join(invented),
        )
    )
    return results


def db_checks(expect: Expectation, state: DbState) -> list[CheckResult]:
    """The database, not the agent's words, decides whether a return or handoff happened."""
    expected_returns = [expect.return_created] if expect.return_created else []
    results = [
        CheckResult(
            name=f"new returns are {expected_returns or 'none'}",
            passed=state.new_returns == expected_returns,
            detail=", ".join(state.new_returns),
        )
    ]
    reason = state.handoff_reason
    match expect.handoff:
        case "none":
            passed, name = reason is None, "no handoff"
        case "any":
            passed, name = reason is not None, "handed off"
        case "optional":
            return results
        case specific:
            passed, name = reason == specific, f"handed off for {specific}"
    results.append(CheckResult(name=name, passed=passed, detail=reason or ""))
    return results
