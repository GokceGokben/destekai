"""Turns scenario results into metrics, a JSON report and a Markdown table."""

import json
import math
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from statistics import mean
from typing import Any

from evals.runner import ScenarioResult

REPORT_DIR = Path(__file__).parent / "reports"


def _rate(results: list[ScenarioResult], test: Callable[[ScenarioResult], bool]) -> float | None:
    return round(sum(map(test, results)) / len(results), 3) if results else None


def _percentile(values: list[float], share: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(share * len(ordered)) - 1)]


def _all_pass(result: ScenarioResult, prefix: tuple[str, ...]) -> bool:
    return all(c.passed for c in result.checks if c.name.startswith(prefix))


def summarize(
    results: list[ScenarioResult],
    price_input: float | None = None,
    price_output: float | None = None,
) -> dict[str, Any]:
    finished = [r for r in results if r.ended_by != "agent_error"]
    judged = [r for r in finished if r.verdict is not None]
    with_tool_checks = [r for r in finished if any(c.name.startswith("calls") for c in r.checks)]
    turns = [turn for r in finished for turn in r.turns]
    latencies = [turn.latency_ms for turn in turns]
    first_tokens = [turn.first_token_ms for turn in turns if turn.first_token_ms is not None]
    inputs = [sum(t.input_tokens for t in r.turns) for r in finished]
    outputs = [sum(t.output_tokens for t in r.turns) for r in finished]

    cost = None
    if price_input is not None and price_output is not None and finished:
        cost = round(
            mean(
                i * price_input / 1e6 + o * price_output / 1e6
                for i, o in zip(inputs, outputs, strict=True)
            ),
            6,
        )

    return {
        "scenarios": len(results),
        "finished": len(finished),
        "agent_errors": len(results) - len(finished),
        "judge_errors": len(finished) - len(judged),
        "task_success_rate": _rate(finished, lambda r: r.success),
        "tool_accuracy": _rate(with_tool_checks, lambda r: _all_pass(r, ("calls", "never calls"))),
        "db_check_rate": _rate(
            finished, lambda r: _all_pass(r, ("new returns", "no handoff", "handed off"))
        ),
        "adversarial_pass_rate": _rate([r for r in finished if r.adversarial], lambda r: r.success),
        "hallucination_rate": _rate(judged, lambda r: bool(r.verdict and r.verdict.hallucination)),
        "policy_compliance_rate": _rate(
            judged, lambda r: bool(r.verdict and r.verdict.policy_compliance)
        ),
        "avg_turns": round(mean(len(r.turns) for r in finished), 2) if finished else None,
        "avg_latency_ms": round(mean(latencies), 1) if latencies else None,
        "p95_latency_ms": _percentile(latencies, 0.95),
        "avg_first_token_ms": round(mean(first_tokens), 1) if first_tokens else None,
        "avg_input_tokens": round(mean(inputs), 1) if inputs else None,
        "avg_output_tokens": round(mean(outputs), 1) if outputs else None,
        "avg_cost_usd": cost,
    }


def by_category(results: list[ScenarioResult]) -> list[dict[str, Any]]:
    rows = []
    for category in sorted({r.category for r in results}):
        group = [r for r in results if r.category == category and r.ended_by != "agent_error"]
        rows.append(
            {
                "category": category,
                "scenarios": len(group),
                "task_success_rate": _rate(group, lambda r: r.success),
            }
        )
    return rows


def build_report(
    results: list[ScenarioResult],
    run_id: str,
    models: dict[str, str],
    eval_tokens: dict[str, int],
    price_input: float | None = None,
    price_output: float | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "created_at": created_at or datetime.now().astimezone().isoformat(timespec="seconds"),
        "models": models,
        "summary": summarize(results, price_input, price_output),
        "categories": by_category(results),
        "eval_tokens": eval_tokens,
        # Full conversations, for the admin panel's replay view.
        "results": [result.model_dump(mode="json") for result in results],
    }


def _percent(value: float | None) -> str:
    return "–" if value is None else f"%{value * 100:.1f}"


def _number(value: float | None, unit: str = "") -> str:
    return "–" if value is None else f"{value:,.0f}{unit}".replace(",", ".")


def render_markdown(report: dict[str, Any]) -> str:
    s = report["summary"]
    cost = "fiyat girilmedi" if s["avg_cost_usd"] is None else f"${s['avg_cost_usd']:.4f}"
    lines = [
        f"# Değerlendirme raporu — {report['run_id']}",
        "",
        f"Ajan modeli: `{report['models']['agent']}` · Simülatör: `{report['models']['simulator']}`"
        f" · Yargıç: `{report['models']['judge']}`",
        "",
        "| Metrik | Değer |",
        "|---|---|",
        f"| Senaryo (tamamlanan / toplam) | {s['finished']} / {s['scenarios']} |",
        f"| Görev başarı oranı | {_percent(s['task_success_rate'])} |",
        f"| Doğru araç kullanımı | {_percent(s['tool_accuracy'])} |",
        f"| Veritabanı kontrolleri | {_percent(s['db_check_rate'])} |",
        f"| Saldırgan senaryo başarısı | {_percent(s['adversarial_pass_rate'])} |",
        f"| Halüsinasyon oranı | {_percent(s['hallucination_rate'])} |",
        f"| Politika uyumu | {_percent(s['policy_compliance_rate'])} |",
        f"| Ortalama gecikme (p95) | {_number(s['avg_latency_ms'], ' ms')} "
        f"({_number(s['p95_latency_ms'], ' ms')}) |",
        f"| İlk token süresi | {_number(s['avg_first_token_ms'], ' ms')} |",
        f"| Konuşma başına token (girdi / çıktı) | {_number(s['avg_input_tokens'])} / "
        f"{_number(s['avg_output_tokens'])} |",
        f"| Konuşma başına maliyet | {cost} |",
        "",
        "## Kategoriler",
        "",
        "| Kategori | Senaryo | Başarı |",
        "|---|---|---|",
        *(
            f"| {row['category']} | {row['scenarios']} | {_percent(row['task_success_rate'])} |"
            for row in report["categories"]
        ),
        "",
        "## Senaryolar",
        "",
        "| Senaryo | Kategori | Sonuç | Tur | Başarısız kontroller | Yargıç |",
        "|---|---|---|---|---|---|",
    ]
    for result in report["results"]:
        parsed = ScenarioResult.model_validate(result)
        failed = ", ".join(c.name for c in parsed.checks if not c.passed) or "–"
        verdict = parsed.verdict.reasoning if parsed.verdict else "yargılanamadı"
        outcome = (
            "✅" if parsed.success else ("⚠️ hata" if parsed.ended_by == "agent_error" else "❌")
        )
        lines.append(
            f"| {parsed.id} | {parsed.category} | {outcome} | {len(parsed.turns)} | {failed} "
            f"| {verdict.replace('|', '/').replace(chr(10), ' ')} |"
        )
    return "\n".join(lines) + "\n"


def carry_over(
    run_id: str, session_tokens: dict[str, int], directory: Path = REPORT_DIR
) -> tuple[str | None, dict[str, int]]:
    """The date and evaluation tokens for a run's report, counting earlier sessions.

    A run resumed over several days, or rebuilt with --report-only, writes its report again.
    It keeps the date of its first report, and the simulator and judge tokens of earlier
    sessions are added to this session's, which are zero when no model was called.
    """
    path = directory / f"{run_id}.json"
    if not path.exists():
        return None, session_tokens
    previous = json.loads(path.read_text(encoding="utf-8"))
    earlier = previous.get("eval_tokens", {})
    tokens = {key: value + earlier.get(key, 0) for key, value in session_tokens.items()}
    return previous.get("created_at"), tokens


def write_report(
    report: dict[str, Any], directory: Path = REPORT_DIR, update_latest: bool = True
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    (directory / f"{report['run_id']}.json").write_text(text, encoding="utf-8")
    # The admin panel reads this one, so an interrupted run must not replace it.
    if update_latest:
        (directory / "latest.json").write_text(text, encoding="utf-8")
    markdown = directory / f"{report['run_id']}.md"
    markdown.write_text(render_markdown(report), encoding="utf-8")
    return markdown
