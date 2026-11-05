"""Runs one scenario end to end: reset, converse, check, judge."""

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from evals.agent_client import BUSY_MARKER, AgentClient, AgentTurn
from evals.checks import CheckResult, behaviour_checks, db_checks, tool_checks
from evals.db import EvalDatabase
from evals.judge import Judge, Verdict
from evals.llm import TextModel
from evals.scenario import Scenario
from evals.simulator import CustomerSimulator

EndReason = Literal["simulator", "handoff", "max_turns", "agent_error"]


class RateLimited(Exception):
    """The agent's model is out of quota. The scenario is not recorded, so a resumed run
    tries it again."""


class ScenarioResult(BaseModel):
    id: str
    category: str
    adversarial: bool
    customer_id: str
    conversation_id: str
    ended_by: EndReason
    turns: list[AgentTurn]
    checks: list[CheckResult]
    verdict: Verdict | None

    @property
    def checks_passed(self) -> bool:
        return all(check.passed for check in self.checks)

    @property
    def success(self) -> bool:
        """Both views must agree: the checks on what happened and the judge on the replies."""
        return (
            self.ended_by != "agent_error"
            and self.checks_passed
            and self.verdict is not None
            and self.verdict.task_success
        )


@dataclass
class Runner:
    db: EvalDatabase
    agent_url: str
    jwt_secret: str
    simulator_model: TextModel
    judge: Judge

    async def run(self, scenario: Scenario) -> ScenarioResult:
        since = await self.db.reset()
        simulator = CustomerSimulator(self.simulator_model, scenario)
        turns: list[AgentTurn] = []
        ended_by: EndReason = "max_turns"

        async with AgentClient(self.agent_url, self.jwt_secret, scenario.customer_id) as agent:
            message: str | None = scenario.opening_message
            while message is not None:
                turn = await agent.send(message)
                turns.append(turn)
                if turn.error:
                    if BUSY_MARKER in turn.error:
                        raise RateLimited(scenario.id)
                    ended_by = "agent_error"
                    break
                # A handed-off conversation only gets the "a person will answer" reply.
                if turn.handoff_reason:
                    ended_by = "handoff"
                    break
                if len(turns) >= scenario.max_turns:
                    break
                message = await simulator.next_message(turns)
                if message is None:
                    ended_by = "simulator"
            conversation_id = agent.conversation_id

        state = await self.db.state(scenario.customer_id, conversation_id, since)
        checks: list[CheckResult] = [
            *tool_checks(scenario.expect, turns),
            *behaviour_checks(scenario.expect, turns),
            *db_checks(scenario.expect, state),
        ]
        verdict = None if ended_by == "agent_error" else await self.judge.evaluate(scenario, turns)
        return ScenarioResult(
            id=scenario.id,
            category=scenario.category,
            adversarial=scenario.adversarial,
            customer_id=scenario.customer_id,
            conversation_id=conversation_id,
            ended_by=ended_by,
            turns=turns,
            checks=checks,
            verdict=verdict,
        )
