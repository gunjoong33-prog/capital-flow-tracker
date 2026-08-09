import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { ibmPlexMono, mrsSaintDelafield } from "@/lib/site-fonts";
import { RATE_TYPE_METRICS, type PeriodType } from "@/lib/period-report";
import siteStyles from "@/styles/site.module.css";
import styles from "../../reports.module.css";

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

        <section className={styles.card}>
          <h2 className={styles.card__title}>기간 내 주요 지표 변화</h2>
          {/* 크레딧 스프레드·실질금리·국채금리·VIX는 원자료가 이미 %(포인트) 단위라, "%가 몇 %
              움직였는지"(상대 변화율)를 그대로 보여주면 실제보다 훨씬 크게 움직인 것처럼 보인다
              (281bp→284bp가 "+1.07%"로 표시되던 문제, 사용자 지적) — 이 5개는 bp/포인트
              절대 변화폭을 대신 보여준다. */}
          {Object.entries(summary.metricChangesPct ?? {}).map(([metric, pct]) => {
            const isRateType = RATE_TYPE_METRICS.has(metric);
            const bp = summary.metricPointChangesBp?.[metric] ?? null;
            const value = isRateType ? bp : pct;
            const unit = isRateType ? (metric === "VIX" ? "pt" : "bp") : "%";
            return (
              <div key={metric} className={styles.metricRow}>
                <span className={styles.metricRow__label}>{METRIC_LABEL[metric] ?? metric}</span>
                <span style={{ color: value === null ? "var(--ink-faint)" : value >= 0 ? "var(--pos)" : "var(--neg)" }}>
                  {value === null ? "확인 못함" : `${value > 0 ? "+" : ""}${value}${unit}`}
                </span>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
