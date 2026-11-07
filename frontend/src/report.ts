import { useEffect, useState } from "react";

// The shape of evals/reports/latest.json, written by evals/report.py.

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

export interface EvalTurn {
  customer: string;
  reply: string;
  tools: ToolTrace[];
  guardrail: boolean;
  handoff_reason: string | null;
  ungrounded: string[];
  error: string | null;
  first_token_ms: number | null;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
}

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface Verdict {
  task_success: boolean;
  hallucination: boolean;
  policy_compliance: boolean;
  reasoning: string;
}

export interface ScenarioResult {
  id: string;
  category: string;
  adversarial: boolean;
  customer_id: string;
  conversation_id: string;
  ended_by: "simulator" | "handoff" | "max_turns" | "agent_error";
  turns: EvalTurn[];
  checks: CheckResult[];
  verdict: Verdict | null;
}

interface Summary {
  scenarios: number;
  finished: number;
  agent_errors: number;
  judge_errors: number;
  task_success_rate: number | null;
  tool_accuracy: number | null;
  db_check_rate: number | null;
  adversarial_pass_rate: number | null;
  hallucination_rate: number | null;
  policy_compliance_rate: number | null;
  avg_turns: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  avg_first_token_ms: number | null;
  avg_input_tokens: number | null;
  avg_output_tokens: number | null;
  avg_cost_usd: number | null;
}

export interface EvalReport {
  run_id: string;
  created_at: string;
  models: { agent: string; simulator: string; judge: string };
  summary: Summary;
  categories: { category: string; scenarios: number; task_success_rate: number | null }[];
  results: ScenarioResult[];
}

/** Mirrors ScenarioResult.success in evals/runner.py. */
export function succeeded(result: ScenarioResult): boolean {
  return (
    result.ended_by !== "agent_error" &&
    result.checks.every((check) => check.passed) &&
    result.verdict?.task_success === true
  );
}

export const CATEGORY_LABELS: Record<string, string> = {
  order_status: "Sipariş Durumu",
  shipping: "Kargo",
  returns: "İade",
  policy: "Politika",
  handoff: "İnsana Devir",
  ambiguous: "Belirsiz İstek",
  injection: "Prompt Injection",
  other_customer: "Başka Müşteri",
  out_of_scope: "Kapsam Dışı",
};

const REPORT_URL = "/reports/latest.json";

type ReportState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; report: EvalReport };

/** The report is behind an admin check in nginx, so the admin's token goes along. */
export function useReport(token: string, onUnauthorized: () => void): ReportState {
  const [state, setState] = useState<ReportState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    fetch(REPORT_URL, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (response.status === 401 || response.status === 403) onUnauthorized();
        return response.ok ? response.json() : null;
      })
      .then((report: EvalReport | null) => {
        if (active) setState(report ? { status: "ready", report } : { status: "missing" });
      })
      .catch(() => active && setState({ status: "missing" }));
    return () => {
      active = false;
    };
  }, [token, onUnauthorized]);
  return state;
}

/**
 * Saves the report the panel already holds; a link to the report URL could not send the
 * admin's token. The file URL is made on click and freed after the browser has taken it:
 * one made ahead and freed in an effect's cleanup is already gone when React's development
 * mode runs effects twice, and the browser then reports a network error.
 */
export function downloadReport(report: EvalReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `destekai-eval-${report.run_id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
