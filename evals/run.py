"""Command line entry point.

    uv run --project agent-service python -m evals.run --subset 5
    uv run --project agent-service python -m evals.run --category injection
    uv run --project agent-service python -m evals.run --resume 20261105-1412

Results are appended to reports/runs/<run id>.jsonl as each scenario finishes, so a run
stopped by a rate limit loses nothing and --resume continues with the rest.
"""

import argparse
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path

from app.llm.base import RetryableLLMError

from evals.config import EvalSettings
from evals.db import EvalDatabase
from evals.judge import Judge
from evals.llm import build_model
from evals.report import REPORT_DIR, build_report, write_report
from evals.runner import RateLimited, Runner, ScenarioResult
from evals.scenario import Scenario, load_scenarios, select

RUN_DIR = REPORT_DIR / "runs"
# The agent gives up after two quick retries, which is right for a waiting customer but not
# for a per-minute limit. The scenario restarts from a fresh conversation after this pause,
# so no half-finished turn stays in the agent's memory.
AGENT_RETRY_PAUSE_S = 65
AGENT_RETRIES = 2


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the DestekAI evaluation.")
    parser.add_argument("--subset", type=int, help="run N scenarios spread over the categories")
    parser.add_argument("--category", help="run only this category")
    parser.add_argument("--scenario", action="append", help="run this scenario id (repeatable)")
    parser.add_argument("--resume", metavar="RUN_ID", help="continue an interrupted run")
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="rebuild the report of --resume RUN_ID from its results, without model calls",
    )
    return parser.parse_args(argv)


def load_results(path: Path) -> list[ScenarioResult]:
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    return [ScenarioResult.model_validate_json(line) for line in lines if line.strip()]


async def run_with_retries(runner: Runner, scenario: Scenario) -> ScenarioResult:
    for attempt in range(AGENT_RETRIES + 1):
        try:
            return await runner.run(scenario)
        except RateLimited:
            if attempt == AGENT_RETRIES:
                raise
            print(f"agent busy, retrying in {AGENT_RETRY_PAUSE_S}s ...", end=" ", flush=True)
            await asyncio.sleep(AGENT_RETRY_PAUSE_S)
    raise AssertionError("unreachable")


def run_models(path: Path, settings: EvalSettings) -> dict[str, str]:
    """The models a run uses, recorded when it starts. A resumed run or a rebuilt report keeps
    them, even if the settings have changed since; a switched model is a different run."""
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    models = {
        "agent": settings.llm_model,
        "simulator": settings.simulator_model or settings.llm_model,
        "judge": settings.judge_model or settings.llm_model,
    }
    path.write_text(json.dumps(models), encoding="utf-8")
    return models


async def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    settings = EvalSettings()  # type: ignore[call-arg]
    run_id = args.resume or datetime.now().strftime("%Y%m%d-%H%M")
    run_file = RUN_DIR / f"{run_id}.jsonl"
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    models = run_models(RUN_DIR / f"{run_id}.models.json", settings)

    scenarios = select(load_scenarios(), args.subset, args.category, args.scenario)
    done = {result.id for result in load_results(run_file)}
    pending = [] if args.report_only else [s for s in scenarios if s.id not in done]
    print(f"run {run_id}: {len(scenarios)} scenarios, {len(pending)} to go")

    simulator_model = build_model(settings, models["simulator"])
    judge_model = build_model(settings, models["judge"])
    interrupted = False
    async with EvalDatabase(settings.database_url) as db:
        runner = Runner(
            db=db,
            agent_url=settings.agent_url,
            jwt_secret=settings.jwt_secret.get_secret_value(),
            simulator_model=simulator_model,
            judge=Judge(judge_model),
        )
        for number, scenario in enumerate(pending, start=1):
            print(f"[{number}/{len(pending)}] {scenario.id} ...", end=" ", flush=True)
            try:
                result = await run_with_retries(runner, scenario)
            except (RateLimited, RetryableLLMError) as exc:
                # Each model has its own quota, so say which one ran out.
                who = "agent" if isinstance(exc, RateLimited) else "simulator or judge"
                print(f"{who} rate limited; stopping. Continue later with --resume {run_id}")
                interrupted = True
                break
            with run_file.open("a", encoding="utf-8") as file:
                file.write(result.model_dump_json() + "\n")
            print("ok" if result.success else "FAILED")

    results = [r for r in load_results(run_file) if r.id in {s.id for s in scenarios}]
    if not results:
        print("no finished scenarios yet; no report written")
        return 1
    report = build_report(
        results,
        run_id,
        models=models,
        eval_tokens={
            "simulator_input": simulator_model.tokens.input_tokens,
            "simulator_output": simulator_model.tokens.output_tokens,
            "judge_input": judge_model.tokens.input_tokens,
            "judge_output": judge_model.tokens.output_tokens,
        },
        price_input=settings.price_input_per_mtok,
        price_output=settings.price_output_per_mtok,
    )
    path = write_report(report, update_latest=not interrupted and bool(results))
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print(f"report: {path}")
    return 1 if interrupted else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
