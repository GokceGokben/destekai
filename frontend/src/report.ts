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

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface Verdict {
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

export interface Summary {
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

export const REPORT_URL = "/reports/latest.json";

export type ReportState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; report: EvalReport };

export function useReport(): ReportState {
  const [state, setState] = useState<ReportState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    fetch(REPORT_URL, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((report: EvalReport | null) => {
        if (active) setState(report ? { status: "ready", report } : { status: "missing" });
      })
      .catch(() => active && setState({ status: "missing" }));
    return () => {
      active = false;
    };
  }, []);
  return state;
}
