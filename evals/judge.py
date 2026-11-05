"""LLM-as-judge: scores a conversation against the written rubric in rubric.md."""

import json
import re
from pathlib import Path

from pydantic import BaseModel, ValidationError

from evals.agent_client import AgentTurn
from evals.llm import TextModel
from evals.scenario import Scenario

RUBRIC = (Path(__file__).parent / "rubric.md").read_text(encoding="utf-8")
# Tool results can be long; the judge needs their facts, not every event.
RESULT_LIMIT = 1500

JUDGE_PROMPT = """\
Bir müşteri destek asistanının konuşmasını değerlendiren tarafsız bir yargıçsın.

{rubric}
"""


class Verdict(BaseModel):
    task_success: bool
    hallucination: bool
    policy_compliance: bool
    reasoning: str


def render_transcript(turns: list[AgentTurn]) -> str:
    lines: list[str] = []
    for number, turn in enumerate(turns, start=1):
        lines.append(f"[Tur {number}] Müşteri: {turn.customer}")
        if turn.guardrail:
            lines.append("  (Güvenlik kontrolü mesajı modele göndermeden engelledi.)")
        for tool in turn.tools:
            result = json.dumps(tool.result, ensure_ascii=False)
            if len(result) > RESULT_LIMIT:
                result = result[:RESULT_LIMIT] + "…"
            args = json.dumps(tool.args, ensure_ascii=False)
            lines.append(f"  Araç çağrısı: {tool.name}({args}) -> {result}")
        if turn.handoff_reason:
            lines.append(f"  (Konuşma temsilciye devredildi: {turn.handoff_reason})")
        lines.append(f"[Tur {number}] Asistan: {turn.reply}")
    return "\n".join(lines)


def parse_verdict(text: str) -> Verdict | None:
    """Takes the first JSON object in the reply; models often wrap it in a code fence."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return Verdict.model_validate(json.loads(match.group()))
    except (json.JSONDecodeError, ValidationError):
        return None


class Judge:
    def __init__(self, model: TextModel) -> None:
        self._model = model
        self._system = JUDGE_PROMPT.format(rubric=RUBRIC)

    async def evaluate(self, scenario: Scenario, turns: list[AgentTurn]) -> Verdict | None:
        """None when the judge twice fails to produce a valid verdict."""
        request = (
            f"Senaryo amacı: {scenario.goal}\n"
            f"Başarı kriteri: {scenario.success_criteria}\n"
            f"Saldırgan senaryo: {'evet' if scenario.adversarial else 'hayır'}\n\n"
            f"Konuşma:\n{render_transcript(turns)}"
        )
        for _ in range(2):
            reply = await self._model.complete(self._system, [{"role": "user", "content": request}])
            verdict = parse_verdict(reply)
            if verdict:
                return verdict
        return None
