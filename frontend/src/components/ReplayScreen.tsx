import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CATEGORY_LABELS, useReport, type EvalTurn, type ScenarioResult, type ToolTrace } from "../report";
import { HREF } from "../route";
import { AdminBadge } from "./AdminHome";
import {
  CheckList,
  OutcomeBadge,
  seconds,
  totalLatency,
  VerdictCriteria,
} from "./AdminScreen";
import { AppHeader } from "./AppHeader";
import { MessageMarkdown } from "./ChatPanel";
import { Icon } from "./Icon";

const END_LABELS: Record<ScenarioResult["ended_by"], string> = {
  simulator: "Müşteri konuşmayı bitirdi",
  handoff: "Temsilciye devredildi",
  max_turns: "Tur sınırına ulaşıldı",
  agent_error: "Ajan hatası",
};

interface Props {
  id: string;
  token: string;
  onLogout: () => void;
}

export function ReplayScreen({ id, token, onLogout }: Props) {
  const state = useReport(token, onLogout);
  const result = state.status === "ready" ? state.report.results.find((r) => r.id === id) : undefined;
  const agentModel = state.status === "ready" ? state.report.models.agent : "";

  return (
    <>
      <AppHeader active="Yönetici Değerlendirme & Test Paneli">
        <AdminBadge onLogout={onLogout} />
      </AppHeader>
      <main className="w-full pt-16 bg-surface bg-pattern min-h-screen">
        <div className="mx-auto w-full max-w-7xl px-gutter-sm lg:px-margin py-space-lg flex flex-col gap-gutter">
          <nav className="flex items-center gap-space-xs font-label-sm text-label-sm text-on-surface-variant">
            <a href={HREF.admin} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Icon name="arrow_back" className="text-[16px]" /> Test Listesine Dön
            </a>
            <span>/</span>
            <span>Konuşma Tekrarı</span>
          </nav>
          {state.status === "loading" && <Skeleton className="h-64 rounded-xl" />}
          {state.status !== "loading" && !result && (
            <p className="font-body-md text-body-md text-on-surface-variant">
              Bu senaryo son raporda bulunamadı.
            </p>
          )}
          {result && <Replay result={result} agentModel={agentModel} />}
        </div>
      </main>
    </>
  );
}

function Replay({ result, agentModel }: { result: ScenarioResult; agentModel: string }) {
  const tokens = result.turns.reduce((sum, t) => sum + t.input_tokens + t.output_tokens, 0);
  const toolCalls = result.turns.flatMap((t) => t.tools);
  const failedTools = toolCalls.filter((tool) => tool.result && "error" in tool.result);
  return (
    <>
      <Card className="gap-space-sm py-space-md">
        <CardContent className="flex flex-col gap-space-sm">
          <div className="flex flex-wrap items-center gap-space-xs">
            <span className="px-2 py-0.5 rounded-md bg-surface-container font-code-sm text-code-sm text-primary">
              {result.id}
            </span>
            <OutcomeBadge result={result} />
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              {CATEGORY_LABELS[result.category] ?? result.category}
              {result.adversarial && " • saldırgan senaryo"}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-space-xs">
            <Fact icon="timer" label="Toplam Süre" value={seconds(totalLatency(result))} />
            <Fact icon="forum" label="Konuşma Turu" value={`${result.turns.length} tur`} />
            <Fact icon="memory" label="Ajan Modeli" value={agentModel} />
            <Fact icon="token" label="Toplam Token" value={tokens.toLocaleString("tr-TR")} />
            <Fact icon="flag" label="Bitiş" value={END_LABELS[result.ended_by]} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter items-start">
        <Card className="lg:col-span-2 gap-0 py-0">
          <div className="flex items-center justify-between gap-space-sm p-space-md border-b border-surface-variant/40">
            <h2 className="flex items-center gap-1.5 font-headline-sm text-headline-sm text-on-surface">
              <span className="w-2 h-2 rounded-full bg-secondary" />
              Simüle Müşteri & DestekAI Konuşma Kaydı
            </h2>
            <span className="font-code-sm text-[11px] text-on-surface-variant">
              {result.customer_id} • {result.conversation_id}
            </span>
          </div>
          <ol className="flex flex-col">
            {result.turns.map((turn, index) => (
              <TurnView key={index} turn={turn} number={index + 1} total={result.turns.length} />
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-space-sm px-space-md py-space-sm border-t border-surface-variant/40 font-label-sm text-label-sm text-on-surface-variant">
            <span>{END_LABELS[result.ended_by]}</span>
            <span>•</span>
            <span>
              {toolCalls.length - failedTools.length}/{toolCalls.length} araç çağrısı başarılı
            </span>
          </div>
        </Card>

        <Card className="gap-0 py-0 lg:sticky lg:top-20 bg-surface-container-low dark:bg-[#2a2c30]">
          <div className="p-space-md flex flex-col gap-space-sm">
            <div className="flex items-center justify-between">
              <span className="font-code-sm text-[11px] tracking-wider text-ai">OTOMATİK HAKEM RAPORU</span>
              <OutcomeBadge result={result} />
            </div>
            <h2 className="font-headline-sm text-headline-sm text-on-surface">LLM & Politika Denetimi</h2>
            <VerdictCriteria result={result} />
            <div className="rounded-lg bg-card p-space-sm">
              <span className="font-label-md text-label-md font-semibold text-on-surface">
                Hakem Değerlendirme Notu
              </span>
              <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
                {result.verdict?.reasoning ?? "Yargıç bu konuşma için geçerli bir değerlendirme üretemedi."}
              </p>
            </div>
            <span className="font-label-md text-label-md font-semibold text-on-surface">
              Deterministik Kontroller
            </span>
            <CheckList result={result} />
          </div>
        </Card>
      </div>
    </>
  );
}

function Fact({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-container-low px-space-sm py-space-xs">
      <span className="flex items-center gap-1 font-label-sm text-[11px] text-on-surface-variant">
        <Icon name={icon} className="text-[14px]" /> {label}
      </span>
      <span className="font-label-md text-label-md font-semibold text-on-surface">{value}</span>
    </div>
  );
}

function TurnView({ turn, number, total }: { turn: EvalTurn; number: number; total: number }) {
  return (
    <li className="flex flex-col gap-space-sm p-space-md border-b border-surface-variant/30 last:border-b-0">
      <span className="w-fit px-2 py-0.5 rounded bg-surface-container font-code-sm text-[11px] text-on-surface-variant">
        TUR {number} / {total}
      </span>
      <Speaker icon="person" name="Simüle Müşteri">
        <p className="rounded-xl bg-surface-container-low px-space-sm py-space-xs font-body-md text-body-md text-on-surface">
          {turn.customer}
        </p>
      </Speaker>
      {turn.guardrail && (
        <Notice icon="shield" tone="warning">
          Güvenlik kontrolü bu mesajı modele göndermeden engelledi.
        </Notice>
      )}
      {turn.tools.map((tool, index) => (
        <ToolBlock key={index} tool={tool} />
      ))}
      <Speaker
        icon="smart_toy"
        name="DestekAI Asistan"
        meta={[
          turn.first_token_ms === null ? null : `İlk token ${seconds(turn.first_token_ms)}`,
          `Toplam ${seconds(turn.latency_ms)}`,
          `${turn.input_tokens + turn.output_tokens} token`,
        ]}
        agent
      >
        <div className="rounded-xl bg-ai-surface border border-ai-soft/40 px-space-sm py-space-xs font-body-md text-body-md text-on-surface [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5">
          {turn.error ? <span className="text-error">{turn.error}</span> : <MessageMarkdown text={turn.reply} />}
        </div>
      </Speaker>
      {turn.handoff_reason && (
        <Notice icon="support_agent" tone="info">
          Konuşma temsilciye devredildi ({turn.handoff_reason}).
        </Notice>
      )}
      {turn.ungrounded.length > 0 && (
        <Notice icon="report" tone="danger">
          Araç sonucunda olmayan numara: {turn.ungrounded.join(", ")}
        </Notice>
      )}
    </li>
  );
}

function Speaker({
  icon,
  name,
  meta = [],
  agent = false,
  children,
}: {
  icon: string;
  name: string;
  meta?: (string | null)[];
  agent?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-space-sm">
      <span
        className={cn(
          "w-9 h-9 shrink-0 rounded-full flex items-center justify-center",
          agent ? "bg-ai text-white" : "bg-surface-container text-on-surface-variant",
        )}
      >
        <Icon name={icon} className="text-[18px]" />
      </span>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-space-xs font-label-md text-label-md">
          <b className={agent ? "text-ai" : "text-on-surface"}>{name}</b>
          {meta.filter(Boolean).map((item) => (
            <span key={item} className="font-code-sm text-[11px] text-on-surface-variant">
              • {item}
            </span>
          ))}
        </span>
        {children}
      </div>
    </div>
  );
}

function ToolBlock({ tool }: { tool: ToolTrace }) {
  const failed = tool.result !== null && "error" in tool.result;
  return (
    <details className="ml-12 rounded-xl bg-[#1d1f22] text-[#e6e6e6] overflow-hidden" open={failed}>
      <summary className="flex items-center gap-space-xs px-space-sm py-2 cursor-pointer font-code-sm text-code-sm">
        <Icon name="account_tree" className="text-[16px] text-[#8ab4f8]" />
        <span className="text-[#8ab4f8]">{tool.name}</span>
        <span
          className={cn(
            "ml-1 px-1.5 rounded text-[11px]",
            failed ? "bg-red-900/60 text-red-200" : "bg-emerald-900/60 text-emerald-200",
          )}
        >
          {failed ? "Hata" : "Başarılı"}
        </span>
        <span className="ml-auto text-[11px] text-[#9aa0a8]">Girdi / Çıktı</span>
      </summary>
      <pre className="px-space-sm pb-space-sm font-code-sm text-[12px] whitespace-pre-wrap break-words">
        <span className="text-[#9aa0a8]">// Argümanlar{"\n"}</span>
        {JSON.stringify(tool.args, null, 2)}
        <span className="text-[#9aa0a8]">{"\n\n"}// Yanıt{"\n"}</span>
        {JSON.stringify(tool.result, null, 2)}
      </pre>
    </details>
  );
}

const NOTICE_TONES = {
  warning: "border-amber-500 text-amber-700 dark:border-amber-400 dark:text-amber-300",
  info: "border-ai text-ai",
  danger: "border-error text-error",
};

function Notice({
  icon,
  tone,
  children,
}: {
  icon: string;
  tone: keyof typeof NOTICE_TONES;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "ml-12 flex items-center gap-1.5 rounded-lg border bg-card px-space-sm py-1 font-label-sm text-label-sm",
        NOTICE_TONES[tone],
      )}
    >
      <Icon name={icon} className="text-[16px]" />
      {children}
    </p>
  );
}
