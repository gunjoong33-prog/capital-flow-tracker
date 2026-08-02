import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { RATE_TYPE_METRICS, type PeriodType } from "@/lib/period-report";

export const dynamic = "force-dynamic";

const TYPE_MAP: Record<string, PeriodType> = {
  weekly: "week", monthly: "month", quarterly: "quarter", yearly: "year",
};
const LABEL: Record<string, string> = {
  weekly: "주간", monthly: "월간", quarterly: "분기", yearly: "연간",
};

interface PeriodSummary {
  daysWithData: number;
  avgMacroTrendScore: number | null;
  firstScore: number | null;
  lastScore: number | null;
  decisionCounts: Record<string, number>;
  metricChangesPct: Record<string, number | null>;
  metricPointChangesBp: Record<string, number | null>;
}

const METRIC_LABEL: Record<string, string> = {
  WALCL: "Fed 자산(WALCL)", M2: "M2 통화량", TOTRESNS: "은행 지급준비금", RRP: "역레포(RRP)",
  TGA: "재무부 일반계정(TGA)", REAL_RATE: "실질금리", CREDIT_SPREAD: "크레딧 스프레드",
  US10Y: "미국 10년물", JP10Y: "일본 10년물", USDJPY: "엔/달러", USDKRW: "원/달러", DXY: "달러 인덱스",
  SPX: "S&P500", NDX: "나스닥100", RUT: "러셀2000", DJI: "다우존스", BTC: "비트코인",
  GOLD: "금", WTI: "WTI 유가", VIX: "VIX",
};

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ type: string; start: string }>;
}) {
  const { type, start } = await params;
  const periodType = TYPE_MAP[type];
  if (!periodType) notFound();

  const report = await db.periodReport.findUnique({
    where: { periodType_periodStart: { periodType, periodStart: new Date(start) } },
  });
  if (!report) notFound();

  const summary = report.summary as unknown as PeriodSummary;

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto max-w-3xl space-y-6">
        <SiteNav active="reports" />

        <header className="space-y-2">
          <p className="text-sm text-zinc-500">
            {LABEL[type]} 리포트 · {start} ~ {report.periodEnd.toISOString().slice(0, 10)}
          </p>
          <div className="flex items-center gap-3">
            {summary.avgMacroTrendScore !== null && (
              <span className="rounded-full border border-zinc-700 px-3 py-1 text-sm">
                평균 투자 적합도 점수 {summary.avgMacroTrendScore}
              </span>
            )}
            <span className="text-xs text-zinc-500">데이터 있는 날 {summary.daysWithData}일</span>
          </div>
        </header>

        {report.narrative && (
          <p className="whitespace-pre-line rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 text-sm leading-relaxed text-zinc-300">
            {report.narrative}
          </p>
        )}

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">결론 분포</h2>
          <div className="flex gap-4 text-sm">
            {Object.entries(summary.decisionCounts ?? {}).map(([decision, count]) => (
              <span key={decision} className="text-zinc-200">{decision} <span className="text-zinc-500">{count}일</span></span>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">기간 내 주요 지표 변화</h2>
          {/* 크레딧 스프레드·실질금리·국채금리·VIX는 원자료가 이미 %(포인트) 단위라, "%가 몇 %
              움직였는지"(상대 변화율)를 그대로 보여주면 실제보다 훨씬 크게 움직인 것처럼 보인다
              (281bp→284bp가 "+1.07%"로 표시되던 문제, 사용자 지적) — 이 5개는 bp/포인트
              절대 변화폭을 대신 보여준다. */}
          <div className="space-y-1.5 text-sm">
            {Object.entries(summary.metricChangesPct ?? {}).map(([metric, pct]) => {
              const isRateType = RATE_TYPE_METRICS.has(metric);
              const bp = summary.metricPointChangesBp?.[metric] ?? null;
              const value = isRateType ? bp : pct;
              const unit = isRateType ? (metric === "VIX" ? "pt" : "bp") : "%";
              return (
                <div key={metric} className="flex items-baseline justify-between border-b border-zinc-800/60 py-1 last:border-0">
                  <span className="text-zinc-500">{METRIC_LABEL[metric] ?? metric}</span>
                  <span className={value === null ? "text-zinc-600" : value >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    {value === null ? "확인 못함" : `${value > 0 ? "+" : ""}${value}${unit}`}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
