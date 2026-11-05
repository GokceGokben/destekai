"""The scenario set itself: valid, large enough, and consistent with the seed data."""

import re

import pytest
from app.guardrails.escalation import FRUSTRATION_THRESHOLD, frustration_score, wants_human
from app.guardrails.injection import detect_injection

from evals.db import SEED_SQL
from evals.scenario import ADVERSARIAL, load_scenarios, select

SCENARIOS = load_scenarios()
SEED = SEED_SQL.read_text(encoding="utf-8")
CUSTOMERS = set(re.findall(r"\('(CUS-\d{4})', '", SEED))
ORDER_OWNERS = dict(re.findall(r"\('(DA-\d{6})', '(CUS-\d{4})'", SEED))


def test_the_set_is_large_enough():
    assert len(SCENARIOS) >= 50
    assert sum(s.adversarial for s in SCENARIOS) >= 10
    for category in ADVERSARIAL:
        assert any(s.category == category for s in SCENARIOS), category


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.id)
def test_scenario_matches_the_seed(scenario):
    assert scenario.customer_id in CUSTOMERS
    if scenario.expect.return_created:
        assert ORDER_OWNERS[scenario.expect.return_created] == scenario.customer_id


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.id)
def test_injection_expectation_matches_the_opening_message(scenario):
    """Catches a scenario whose expectation could never be met on its first message."""
    fired = detect_injection(scenario.opening_message) is not None
    if scenario.expect.guardrail is True:
        assert fired
    elif scenario.expect.guardrail is False:
        assert not fired


@pytest.mark.parametrize(
    "scenario", [s for s in SCENARIOS if s.expect.handoff == "none"], ids=lambda s: s.id
)
def test_calm_openings_do_not_trigger_a_handoff(scenario):
    assert not wants_human(scenario.opening_message)
    assert frustration_score(scenario.opening_message) < FRUSTRATION_THRESHOLD


def test_subset_is_deterministic_and_starts_with_attacks():
    first = select(SCENARIOS, subset=5)
    assert [s.id for s in first] == [s.id for s in select(SCENARIOS, subset=5)]
    assert len(first) == 5
    assert first[0].adversarial
    assert len({s.category for s in first}) == 5


def test_filters():
    assert {s.category for s in select(SCENARIOS, category="returns")} == {"returns"}
    picked = select(SCENARIOS, ids=["return-headphones", "scope-code"])
    assert {s.id for s in picked} == {"return-headphones", "scope-code"}
