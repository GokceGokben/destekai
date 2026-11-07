import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CARD_SHADOW, cn } from "@/lib/utils";

import {
  CATEGORY_LABELS,
  downloadReport,
  succeeded,
  useReport,
  type EvalReport,
  type ScenarioResult,
} from "../report";
import { HREF } from "../route";
import type { Admin } from "../types";
import { AdminBadge } from "./AdminHome";
import { AppHeader } from "./AppHeader";
import { MessageMarkdown } from "./ChatPanel";
import { Icon } from "./Icon";

const RUN_COMMAND = "uv run --project agent-service python -m evals.run --subset 5";

function percent(value: number | null): string {
  return value === null ? "–" : `%${(value * 100).toFixed(1).replace(".", ",")}`;
}

export function seconds(ms: number | null): string {
  return ms === null ? "–" : `${(ms / 1000).toFixed(2).replace(".", ",")} sn`;
}

export function totalLatency(result: ScenarioResult): number {
  return result.turns.reduce((sum, turn) => sum + turn.latency_ms, 0);
}

export function OutcomeBadge({ result }: { result: ScenarioResult }) {
  if (result.ended_by === "agent_error") {
    return <Badge tone="neutral" icon="error" label="Hata" />;
  }
  return succeeded(result) ? (
    <Badge tone="good" icon="check_circle" label="Başarılı" />
  ) : (
    <Badge tone="bad" icon="cancel" label="Başarısız" />
  );
}

const TONES = {
  good: "border-emerald-500 text-emerald-700 dark:border-emerald-400 dark:text-emerald-300",
  bad: "border-error text-error",
  neutral: "border-outline text-on-surface-variant",
};

export function Badge({
  tone,
  icon,
  label,
}: {
  tone: keyof typeof TONES;
  icon: string;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-card font-label-sm text-[12px] font-semibold whitespace-nowrap",
        TONES[tone],
      )}
    >
      <Icon name={icon} filled className="text-[14px]" />
      {label}
    </span>
  );
}

interface Props {
  token: string;
  admin: Admin;
  onLogout: () => void;
}

export function AdminScreen({ token, admin, onLogout }: Props) {
  const state = useReport(token, onLogout);
  return (
    <>
      <AppHeader active="Yönetici Değerlendirme & Test Paneli">
        <AdminBadge admin={admin} onLogout={onLogout} />
      </AppHeader>
      <main className="w-full pt-16 bg-surface bg-pattern min-h-screen">
        <div className="mx-auto w-full max-w-7xl px-gutter-sm lg:px-margin py-space-lg flex flex-col gap-gutter">
          {state.status === "loading" && <LoadingState />}
          {state.status === "missing" && <MissingReport />}
          {state.status === "ready" && <Dashboard report={state.report} />}
        </div>
      </main>
    </>
  );
}

function Dashboard({ report }: { report: EvalReport }) {
  const [filter, setFilter] = useState<"all" | "failed">("all");
  const failed = report.results.filter((r) => !succeeded(r));
  const rows = filter === "all" ? report.results : failed;
  const [selectedId, setSelectedId] = useState(() => (failed[0] ?? report.results[0])?.id);
  const selected = report.results.find((r) => r.id === selectedId);

  return (
    <>
      <PageTitle report={report} />
      <MetricCards report={report} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter items-start">
        <div className="lg:col-span-2 flex flex-col gap-gutter">
          <Card className={cn("gap-0 py-0", CARD_SHADOW)}>
            <div className="flex flex-wrap items-start justify-between gap-space-sm p-space-md border-b border-surface-variant/40">
              <div>
                <h2 className="font-headline-sm text-headline-sm text-on-surface">
                  Otomatik Test Senaryoları
                </h2>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  {report.summary.scenarios} senaryo • Koşu {report.run_id}
                </p>
              </div>
              <Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
                <TabsList>
                  <TabsTrigger value="all">Tümü ({report.results.length})</TabsTrigger>
                  <TabsTrigger value="failed">Başarısızlar ({failed.length})</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <ScenarioTable rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
            <div className="flex flex-wrap items-center justify-between gap-space-sm px-space-md py-space-sm border-t border-surface-variant/40 font-body-sm text-body-sm text-on-surface-variant">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-secondary" />
                {report.results.length - failed.length} / {report.results.length} senaryo başarılı
              </span>
              <button
                type="button"
                onClick={() => downloadReport(report)}
                className="font-code-sm text-code-sm text-primary underline underline-offset-4"
              >
                Raporu JSON Olarak İndir
              </button>
            </div>
          </Card>
          <CategoryBreakdown report={report} />
        </div>
        {selected && <ScenarioPanel result={selected} />}
      </div>
    </>
  );
}

function PageTitle({ report }: { report: EvalReport }) {
  const created = new Date(report.created_at).toLocaleString("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-space-md">
      <div className="flex flex-col gap-space-xs">
        <span className="inline-flex w-fit items-center gap-1.5 px-space-sm py-1 rounded-full bg-surface-container font-code-sm text-code-sm text-on-surface-variant">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          LLM DEĞERLENDİRME • {created}
        </span>
        <h1 className="font-headline-xl text-headline-xl text-on-surface">
          Yönetici Değerlendirme & LLM Test Paneli
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
          Simüle edilmiş müşterilerle yapılan otomatik konuşmaların sonuçları, deterministik
          kontroller ve LLM yargıcının değerlendirmesi.
        </p>
      </div>
      <div className="flex flex-col gap-space-xs font-code-sm text-code-sm text-on-surface-variant lg:items-end">
        <span>
          Ajan: <b className="text-on-surface">{report.models.agent}</b>
        </span>
        <span>
          Simülatör: <b className="text-on-surface">{report.models.simulator}</b> • Yargıç:{" "}
          <b className="text-on-surface">{report.models.judge}</b>
        </span>
      </div>
    </section>
  );
}

function MetricCards({ report }: { report: EvalReport }) {
  const s = report.summary;
  const passed = report.results.filter(succeeded).length;
  const cost =
    s.avg_cost_usd === null
      ? "Fiyat girilmedi"
      : `$${s.avg_cost_usd.toFixed(4)} / konuşma`;
  return (
    <>
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter">
        <MetricCard
          title="Görev Başarı Oranı"
          value={percent(s.task_success_rate)}
          note={`${passed} / ${s.finished} senaryo başarılı`}
          bar={s.task_success_rate}
        />
        <MetricCard
          title="Halüsinasyon Oranı"
          value={percent(s.hallucination_rate)}
          note="Araç sonucunda olmayan bilgi içeren konuşmalar"
          bar={s.hallucination_rate}
          barTone="bg-error"
        />
        <MetricCard
          title="Ortalama Yanıt Süresi"
          value={seconds(s.avg_latency_ms)}
          note={`p95: ${seconds(s.p95_latency_ms)} • İlk token: ${seconds(s.avg_first_token_ms)}`}
        />
        <MetricCard
          title="Konuşma Başına Token"
          value={s.avg_input_tokens === null ? "–" : Math.round(s.avg_input_tokens + (s.avg_output_tokens ?? 0)).toLocaleString("tr-TR")}
          note={`Girdi ${Math.round(s.avg_input_tokens ?? 0).toLocaleString("tr-TR")} • Çıktı ${Math.round(s.avg_output_tokens ?? 0).toLocaleString("tr-TR")} • ${cost}`}
        />
      </section>
      <section className="grid grid-cols-2 xl:grid-cols-4 gap-gutter">
        <SmallStat label="Doğru Araç Kullanımı" value={percent(s.tool_accuracy)} icon="build" />
        <SmallStat label="Veritabanı Kontrolleri" value={percent(s.db_check_rate)} icon="database" />
        <SmallStat label="Saldırgan Senaryo Başarısı" value={percent(s.adversarial_pass_rate)} icon="shield" />
        <SmallStat label="Politika Uyumu" value={percent(s.policy_compliance_rate)} icon="gavel" />
      </section>
    </>
  );
}

function MetricCard({
  title,
  value,
  note,
  bar,
  barTone = "bg-primary",
}: {
  title: string;
  value: string;
  note: string;
  bar?: number | null;
  barTone?: string;
}) {
  return (
    <Card className={cn("gap-space-sm py-space-md", CARD_SHADOW)}>
      <CardContent className="flex flex-col gap-space-xs">
        <span className="font-label-md text-label-md text-on-surface-variant">{title}</span>
        <span className="font-headline-xl text-headline-xl text-on-surface">{value}</span>
        <span className="font-body-sm text-body-sm text-on-surface-variant">{note}</span>
        {bar !== undefined && (
          <div className="mt-space-xs h-2 rounded-full bg-surface-container overflow-hidden">
            <div className={cn("h-full rounded-full", barTone)} style={{ width: `${(bar ?? 0) * 100}%` }} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SmallStat({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="flex items-center gap-space-sm rounded-xl border border-surface-variant/60 bg-card px-space-md py-space-sm">
      <Icon name={icon} className="text-primary text-[20px]" />
      <div className="flex flex-col">
        <span className="font-label-sm text-label-sm text-on-surface-variant">{label}</span>
        <span className="font-headline-sm text-headline-sm text-on-surface">{value}</span>
      </div>
    </div>
  );
}

function ScenarioTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ScenarioResult[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="p-space-lg text-center font-body-md text-body-md text-on-surface-variant">
        Başarısız senaryo yok.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="bg-surface-container-low font-label-md text-label-md text-on-surface-variant">
          <tr>
            <th className="px-space-md py-space-sm font-semibold">Senaryo</th>
            <th className="px-space-sm py-space-sm font-semibold">Kategori</th>
            <th className="px-space-sm py-space-sm font-semibold">Sonuç</th>
            <th className="px-space-sm py-space-sm font-semibold">Tur</th>
            <th className="px-space-sm py-space-sm font-semibold">Süre</th>
            <th className="px-space-md py-space-sm font-semibold text-right">İşlem</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((result) => (
            <tr
              key={result.id}
              onClick={() => onSelect(result.id)}
              aria-selected={result.id === selectedId}
              className={cn(
                "border-t border-surface-variant/40 cursor-pointer transition-colors hover:bg-surface-container-low",
                result.id === selectedId && "bg-surface-container-low",
              )}
            >
              <td className="px-space-md py-space-sm">
                <div className="flex flex-col">
                  <span
                    className={cn(
                      "font-label-md text-label-md font-semibold",
                      succeeded(result) ? "text-on-surface" : "text-error",
                    )}
                  >
                    {result.id}
                  </span>
                  <span className="font-code-sm text-[11px] text-on-surface-variant">
                    {result.customer_id} • {result.turns.flatMap((t) => t.tools.map((x) => x.name)).join(", ") || "araç yok"}
                  </span>
                </div>
              </td>
              <td className="px-space-sm py-space-sm">
                <span className="font-body-sm text-body-sm text-on-surface-variant whitespace-nowrap">
                  {CATEGORY_LABELS[result.category] ?? result.category}
                </span>
              </td>
              <td className="px-space-sm py-space-sm">
                <OutcomeBadge result={result} />
              </td>
              <td className="px-space-sm py-space-sm font-code-sm text-code-sm">{result.turns.length}</td>
              <td className="px-space-sm py-space-sm font-code-sm text-code-sm whitespace-nowrap">
                {seconds(totalLatency(result))}
              </td>
              <td className="px-space-md py-space-sm text-right">
                <a
                  href={HREF.replay(result.id)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`${result.id} konuşmasını tekrar oynat`}
                  className="inline-flex w-9 h-9 items-center justify-center rounded-lg bg-surface-container text-primary hover:bg-surface-container-high"
                >
                  <Icon name="play_circle" className="text-[20px]" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryBreakdown({ report }: { report: EvalReport }) {
  return (
    <Card className="gap-space-sm py-space-md">
      <CardContent className="flex flex-col gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm text-on-surface">Kategori Kırılımı</h2>
        {report.categories.map((row) => (
          <div key={row.category} className="grid grid-cols-[10rem_1fr_4.5rem] items-center gap-space-sm">
            <span className="font-body-sm text-body-sm text-on-surface">
              {CATEGORY_LABELS[row.category] ?? row.category}
            </span>
            <div className="h-2 rounded-full bg-surface-container overflow-hidden">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(row.task_success_rate ?? 0) * 100}%` }}
              />
            </div>
            <span className="font-code-sm text-code-sm text-on-surface-variant text-right">
              {percent(row.task_success_rate)} ({row.scenarios})
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function VerdictCriteria({ result }: { result: ScenarioResult }) {
  const v = result.verdict;
  const items = [
    { label: "Görev Başarısı", ok: v?.task_success, good: "Karşılandı", bad: "Karşılanmadı" },
    { label: "Halüsinasyon", ok: v ? !v.hallucination : undefined, good: "Yok", bad: "Var" },
    { label: "Politika Uyumu", ok: v?.policy_compliance, good: "Uyumlu", bad: "İhlal" },
  ];
  return (
    <div className="grid grid-cols-3 gap-space-xs">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-surface-variant/60 bg-card p-space-sm">
          <span className="block font-label-sm text-[11px] text-on-surface-variant">{item.label}</span>
          <span
            className={cn(
              "font-label-md text-label-md font-semibold",
              item.ok === undefined
                ? "text-on-surface-variant"
                : item.ok
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-error",
            )}
          >
            {item.ok === undefined ? "–" : item.ok ? item.good : item.bad}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CheckList({ result }: { result: ScenarioResult }) {
  return (
    <ul className="flex flex-col gap-1">
      {result.checks.map((check) => (
        <li key={check.name} className="flex items-start gap-1.5 font-code-sm text-[12px]">
          <Icon
            name={check.passed ? "check_circle" : "cancel"}
            filled
            className={cn(
              "text-[15px] mt-px",
              check.passed ? "text-emerald-600 dark:text-emerald-400" : "text-error",
            )}
          />
          <span className={check.passed ? "text-on-surface-variant" : "text-error"}>
            {check.name}
            {check.detail && ` (${check.detail})`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ScenarioPanel({ result }: { result: ScenarioResult }) {
  const first = result.turns[0];
  return (
    <Card className="gap-0 py-0 lg:sticky lg:top-20 bg-surface-container-low dark:bg-[#2a2c30]">
      <div className="p-space-md flex flex-col gap-space-sm border-b border-surface-variant/40">
        <div className="flex items-center justify-between gap-space-sm">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">Seçili Senaryo</h2>
          <OutcomeBadge result={result} />
        </div>
        <span className="font-code-sm text-code-sm text-primary">{result.id}</span>
        {first && (
          <div className="flex flex-col gap-space-xs font-body-sm text-body-sm">
            <p className="rounded-lg bg-card p-space-sm text-on-surface">
              <b>Müşteri:</b> {first.customer}
            </p>
            {/* The whole reply, scrolling inside a fixed height; the replay shows the conversation. */}
            <div className="scrollbar-thin max-h-48 overflow-y-auto overscroll-contain rounded-lg bg-ai text-white p-space-sm">
              <MessageMarkdown text={first.reply || "(yanıt yok)"} />
            </div>
          </div>
        )}
      </div>
      <div className="p-space-md flex flex-col gap-space-sm">
        <VerdictCriteria result={result} />
        <div className="rounded-lg bg-card p-space-sm">
          <span className="flex items-center gap-1 font-label-md text-label-md font-semibold text-on-surface">
            <Icon name="gavel" className="text-[16px] text-primary" /> Yargıç Yorumu
          </span>
          <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
            {result.verdict?.reasoning ?? "Yargıç bu konuşma için geçerli bir değerlendirme üretemedi."}
          </p>
        </div>
        <CheckList result={result} />
        <a
          href={HREF.replay(result.id)}
          className="mt-space-xs inline-flex items-center justify-center gap-2 rounded-lg bg-ai px-space-md py-2 font-label-md text-label-md font-semibold text-white hover:bg-ai-deep"
        >
          <Icon name="replay" className="text-[18px]" /> Konuşmayı Tekrar Oynat
        </a>
      </div>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter" aria-label="Rapor yükleniyor">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-36 rounded-xl" />
      ))}
    </div>
  );
}

function MissingReport() {
  return (
    <Card className="py-space-lg">
      <CardContent className="flex flex-col items-center gap-space-sm text-center">
        <Icon name="science" className="text-[40px] text-primary" />
        <h1 className="font-headline-md text-headline-md text-on-surface">Henüz bir değerlendirme raporu yok</h1>
        <p className="font-body-md text-body-md text-on-surface-variant max-w-xl">
          Değerlendirmeyi depo kökünden çalıştırın; rapor bittiğinde bu sayfa onu gösterir.
        </p>
        <code className="rounded-lg bg-surface-container px-space-sm py-1 font-code-sm text-code-sm">
          {RUN_COMMAND}
        </code>
      </CardContent>
    </Card>
  );
}
