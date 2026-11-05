"""The scenario format, and choosing which scenarios to run."""

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SCENARIO_DIR = Path(__file__).parent / "scenarios"

Category = Literal[
    "order_status",
    "shipping",
    "returns",
    "policy",
    "handoff",
    "ambiguous",
    "injection",
    "other_customer",
    "out_of_scope",
]
ADVERSARIAL: set[str] = {"injection", "other_customer", "out_of_scope"}
# "none": must not hand off. "any": must, for any reason. "optional": either is fine.
HandoffExpectation = Literal[
    "none",
    "any",
    "optional",
    "customer_request",
    "frustration",
    "repeated_failures",
    "agent_decision",
]


class Strict(BaseModel):
    # A misspelt key would otherwise be ignored and its check silently skipped.
    model_config = ConfigDict(extra="forbid", frozen=True)


class ToolExpectation(Strict):
    required: list[str] = []
    # At least one of these, for questions a model can answer either way.
    required_any: list[str] = []
    forbidden: list[str] = []


class Expectation(Strict):
    tools: ToolExpectation = ToolExpectation()
    # True: the injection check must fire. False: it must not. None: either is fine.
    guardrail: bool | None = False
    handoff: HandoffExpectation = "none"
    # The one order that may get a new return; every other new return fails the scenario.
    return_created: str | None = None
    # Text that must never appear in the agent's replies, such as another customer's products.
    must_not_mention: list[str] = []


class Scenario(Strict):
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    category: Category
    customer_id: str = Field(pattern=r"^CUS-\d{4}$")
    # Who the simulated customer is and what they know, in Turkish.
    persona: str
    goal: str
    opening_message: str
    expect: Expectation = Expectation()
    # What the judge reads to decide task success.
    success_criteria: str
    max_turns: int = Field(default=10, ge=1, le=10)

    @property
    def adversarial(self) -> bool:
        return self.category in ADVERSARIAL


def load_scenarios(directory: Path = SCENARIO_DIR) -> list[Scenario]:
    scenarios = [
        Scenario.model_validate(item)
        for path in sorted(directory.glob("*.json"))
        for item in json.loads(path.read_text(encoding="utf-8"))
    ]
    ids = [scenario.id for scenario in scenarios]
    duplicates = {i for i in ids if ids.count(i) > 1}
    if duplicates:
        raise ValueError(f"duplicate scenario ids: {sorted(duplicates)}")
    return scenarios


def select(
    scenarios: list[Scenario],
    subset: int | None = None,
    category: str | None = None,
    ids: list[str] | None = None,
) -> list[Scenario]:
    """Filters by id or category, then takes a subset that spreads over the categories.

    The subset is deterministic, so two runs of --subset 5 compare the same scenarios. It
    takes the first scenario of each category in turn, adversarial categories first, so even
    a small subset tests at least one attack.
    """
    chosen = [s for s in scenarios if (not ids or s.id in ids)]
    chosen = [s for s in chosen if (not category or s.category == category)]
    if subset is None or subset >= len(chosen):
        return chosen

    by_category: dict[str, list[Scenario]] = {}
    for scenario in chosen:
        by_category.setdefault(scenario.category, []).append(scenario)
    order = sorted(by_category, key=lambda c: (c not in ADVERSARIAL, c))
    picked: list[Scenario] = []
    while len(picked) < subset:
        for name in order:
            if by_category[name] and len(picked) < subset:
                picked.append(by_category[name].pop(0))
    return picked
