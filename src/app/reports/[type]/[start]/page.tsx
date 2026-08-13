import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { ibmPlexMono, mrsSaintDelafield } from "@/lib/site-fonts";
import {
  RATE_TYPE_METRICS, STEP_METRICS, getPeriodMetricSeries, getPeriodStepScoreSeries,
  type AggregatedBase, type PeriodType,
} from "@/lib/period-report";
import { StepCard } from "@/components/StepCard";
import { STEP_TAB_TITLES } from "@/components/ReportView";
import { MetricSparkline, ScoreTrend, RatioBar, FrequencyBars } from "@/components/PeriodStepGraphs";
import { STEP_TIPS } from "@/lib/scoring/tips";
import siteStyles from "@/styles/site.module.css";
import tabStyles from "@/components/ReportView.module.css";
import styles from "../../reports.module.css";

export const dynamic = "force-dynamic";

const TYPE_MAP: Record<string, PeriodType> = {
  weekly: "week", monthly: "month", quarterly: "quarter", yearly: "year",
};
const LABEL: Record<string, string> = {
  weekly: "주간", monthly: "월간", quarterly: "분기", yearly: "연간",
};

interface PeriodSummary extends AggregatedBase {
  metricChangesPct: Record<string, number | null>;
  metricPointChangesBp: Record<string, number | null>;
}

/** 지표 하나의 기간 변화를 이미 계산된 summary 값(overall delta)에서 그대로 읽어 포맷한다 —
 * ReportDetailPage 상단의 기존 "기간 내 주요 지표 변화" 목록과 같은 숫자를 그래프 쪽에서 다시
 * 계산하지 않기 위함(RATE_TYPE_METRICS 5개는 %가 아니라 bp/pt로, 나머지는 %로). */
function metricDelta(summary: PeriodSummary, metric: string): { label: string | null; positive: boolean | null } {
  const isRateType = RATE_TYPE_METRICS.has(metric);
  const bp = summary.metricPointChangesBp?.[metric] ?? null;
  const pct = summary.metricChangesPct?.[metric] ?? null;
  const value = isRateType ? bp : pct;
  const unit = isRateType ? (metric === "VIX" ? "pt" : "bp") : "%";
  if (value === null) return { label: null, positive: null };
  return { label: `${value > 0 ? "+" : ""}${value}${unit}`, positive: value >= 0 };
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

  // 오늘의 리포트(ReportView.tsx)와 동일한 1~8단계 탭 UI — 거기는 하루치 단일 값을 그리지만
  // 여기는 기간 [periodStart, periodEnd] 안의 일별 추이를 그린다. PeriodReport.summary엔 이
  // 시계열이 없어(LLM 프롬프트용으로 첫날·끝날 델타만 저장, capital_flow_tracker_period_reports
  // 메모리 참고) 페이지 렌더 시점에 원본 테이블에서 직접 조회한다.
  const allStepMetrics = Object.values(STEP_METRICS).flat();
  const [metricSeries, stepScores] = await Promise.all([
    getPeriodMetricSeries(allStepMetrics, report.periodStart, report.periodEnd),
    getPeriodStepScoreSeries(report.periodStart, report.periodEnd),
  ]);

  return (
    <div
      className={`${siteStyles.page} ${ibmPlexMono.variable} ${mrsSaintDelafield.variable}`}
      style={{
        ["--font-gothic" as string]: "'Gothic A1', sans-serif",
        ["--font-sans" as string]: "'IBM Plex Sans KR', sans-serif",
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@500;700;800&family=IBM+Plex+Sans+KR:wght@400;600&display=swap"
      />
      <SiteHeader current="reports" />

      <div className={siteStyles.wrap} style={{ maxWidth: "52rem" }}>
        <div className={styles.detailHead}>
          <p className={styles.detailHead__meta}>
            {LABEL[type]} 리포트 · {start} ~ {report.periodEnd.toISOString().slice(0, 10)}
          </p>
          <div className={styles.detailHead__row}>
            {summary.avgMacroTrendScore !== null && (
              <span className={`${siteStyles.pill} ${siteStyles["pill--neutral"]}`}>
                평균 투자 적합도 점수 {summary.avgMacroTrendScore}
              </span>
            )}
            <span className={styles.detailHead__days}>데이터 있는 날 {summary.daysWithData}일</span>
          </div>
        </div>

        {report.comprehensiveReport && (
          <div>
            <input type="checkbox" id="comprehensive-toggle" className={styles.comprehensiveCheckbox} />
            <label htmlFor="comprehensive-toggle" className={`${styles.comprehensiveToggle} ${styles.comprehensiveToggleOpen}`}>
              종합 보고서 보기
            </label>
            <label htmlFor="comprehensive-toggle" className={`${styles.comprehensiveToggle} ${styles.comprehensiveToggleClose}`}>
              종합 보고서 접기
            </label>
            <div className={styles.comprehensiveBody}>{report.comprehensiveReport}</div>
          </div>
        )}

        <section className={styles.card}>
          <h2 className={styles.card__title}>결론 분포</h2>
          <div className={styles.decisionRow}>
            {Object.entries(summary.decisionCounts ?? {}).map(([decision, count]) => (
              <span key={decision}>
                {decision} <b>{count}일</b>
              </span>
            ))}
          </div>
        </section>

        <h2 className={styles.card__title}>기간 내 주요 지표 변화</h2>

        {/* 8개 라디오는 전부 여기 모아둔다 — ReportView.tsx와 같은 이유(일반 형제 결합자)로
            아래 탭 nav·패널보다 DOM상 앞, 그리고 같은 부모의 직계 형제여야 한다. */}
        <input type="radio" name="step-tab" id="step-tab-1" defaultChecked className="peer/t1 hidden" />
        <input type="radio" name="step-tab" id="step-tab-2" className="peer/t2 hidden" />
        <input type="radio" name="step-tab" id="step-tab-3" className="peer/t3 hidden" />
        <input type="radio" name="step-tab" id="step-tab-4" className="peer/t4 hidden" />
        <input type="radio" name="step-tab" id="step-tab-5" className="peer/t5 hidden" />
        <input type="radio" name="step-tab" id="step-tab-6" className="peer/t6 hidden" />
        <input type="radio" name="step-tab" id="step-tab-7" className="peer/t7 hidden" />
        <input type="radio" name="step-tab" id="step-tab-8" className="peer/t8 hidden" />

        <nav className="flex justify-between gap-1.5 overflow-x-auto pb-1">
          {STEP_TAB_TITLES.map((title, i) => {
            const n = i + 1;
            return (
              <label
                key={n}
                htmlFor={`step-tab-${n}`}
                className={`${tabStyles[`tab${n}`]} flex min-w-[4.2rem] shrink-0 cursor-pointer select-none flex-col items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] px-2 py-2.5 text-[var(--ink-faint)] hover:border-[var(--accent-strong)] hover:text-[var(--ink-dim)]`}
              >
                <span className={`${tabStyles.num} flex h-6 w-6 items-center justify-center rounded-full bg-[var(--border)] text-xs font-bold text-[var(--ink-dim)]`}>
                  {n}
                </span>
                <span className="whitespace-nowrap text-[10px]">{title}</span>
              </label>
            );
          })}
        </nav>

        {/* Fragment로 감싼다 — 감싸는 실제 div를 두면 peer-checked/tN:이 끊긴다(ReportView.tsx에서
            실제 겪은 버그와 동일 원인). */}
        <>
          <div className="mt-3 hidden peer-checked/t1:block">
            <StepCard step={1} title="글로벌 환경" tip={STEP_TIPS[1]}>
              <RatioBar label="거부권 발동 비율" count={summary.vetoDays ?? 0} total={summary.daysWithData} dangerWhenHigh />
            </StepCard>
          </div>

          <div className="mt-3 hidden peer-checked/t2:block">
            <StepCard step={2} title="유동성" score={summary.avgStepScores?.liquidity ?? undefined} tip={STEP_TIPS[2]}>
              {STEP_METRICS[2].map((m) => {
                const d = metricDelta(summary, m);
                return <MetricSparkline key={m} label={METRIC_LABEL[m] ?? m} series={metricSeries[m] ?? []} deltaLabel={d.label} deltaPositive={d.positive} />;
              })}
              <ScoreTrend label="유동성" series={stepScores.map((r) => r.step2)} />
            </StepCard>
          </div>

          <div className="mt-3 hidden peer-checked/t3:block">
            <StepCard step={3} title="캐리 트레이드" score={summary.avgStepScores?.carry ?? undefined} tip={STEP_TIPS[3]}>
              {STEP_METRICS[3].map((m) => {
                const d = metricDelta(summary, m);
                return <MetricSparkline key={m} label={METRIC_LABEL[m] ?? m} series={metricSeries[m] ?? []} deltaLabel={d.label} deltaPositive={d.positive} />;
              })}
              <ScoreTrend label="캐리 트레이드" series={stepScores.map((r) => r.step3)} />
              <RatioBar label="엔화 변동성 급등 감지 비율" count={summary.jpySpikeDays ?? 0} total={summary.daysWithData} dangerWhenHigh />
            </StepCard>
          </div>

          <div className="mt-3 hidden peer-checked/t4:block">
            <StepCard step={4} title="환율·금·유가" score={summary.avgStepScores?.fxGoldOil ?? undefined} tip={STEP_TIPS[4]}>
              {STEP_METRICS[4].map((m) => {
                const d = metricDelta(summary, m);
                return <MetricSparkline key={m} label={METRIC_LABEL[m] ?? m} series={metricSeries[m] ?? []} deltaLabel={d.label} deltaPositive={d.positive} />;
              })}
              <ScoreTrend label="환율·금·유가" series={stepScores.map((r) => r.step4)} />
              <FrequencyBars label="사분면 분포" counts={summary.quadrantCounts ?? {}} />
            </StepCard>
          </div>

          <div className="mt-3 hidden peer-checked/t5:block">
            <StepCard step={5} title="자금 도착" score={summary.avgStepScores?.flows ?? undefined} tip={STEP_TIPS[5]}>
              {STEP_METRICS[5].map((m) => {
                const d = metricDelta(summary, m);
                return <MetricSparkline key={m} label={METRIC_LABEL[m] ?? m} series={metricSeries[m] ?? []} deltaLabel={d.label} deltaPositive={d.positive} />;
              })}
              <ScoreTrend label="자금 도착" series={stepScores.map((r) => r.step5)} />
            </StepCard>
          </div>

          <div className="mt-3 hidden peer-checked/t6:block">
            <StepCard step={6} title="섹터" score={summary.avgStepScores?.sectors ?? undefined} tip={STEP_TIPS[6]}>
              {/* 섹터(GICS 11개)는 시계열로 저장하지 않고 매번 라이브 조회만 하므로(run.ts 주석
                  참고) 기간 그래프용 원자료가 없다 — 대신 기간 내 "충족(자금 유입 판정)" 빈도만
                  보여준다. 없는 데이터를 지어내지 않는다는 이 프로젝트의 원칙을 그대로 따름. */}
              <FrequencyBars label="충족 섹터 빈도" counts={summary.topSectors ?? {}} />
              <ScoreTrend label="섹터" series={stepScores.map((r) => r.step6)} />
            </StepCard>
          </div>

          <div className="mt-3 hidden peer-checked/t7:block">
            <StepCard step={7} title="심리 필터" tip={STEP_TIPS[7]}>
              {STEP_METRICS[7].map((m) => {
                const d = metricDelta(summary, m);
                return <MetricSparkline key={m} label={METRIC_LABEL[m] ?? m} series={metricSeries[m] ?? []} deltaLabel={d.label} deltaPositive={d.positive} />;
              })}
            </StepCard>
          </div>

          <div className="mt-3 hidden peer-checked/t8:block">
            <StepCard step={8} title="최종 결론" score={summary.avgMacroTrendScore ?? undefined} tip={STEP_TIPS[8]}>
              <ScoreTrend label="최종 판단" series={stepScores.map((r) => r.step8)} />
            </StepCard>
          </div>
        </>
      </div>
    </div>
  );
}
