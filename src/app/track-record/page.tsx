import { db } from "@/lib/db";
import { SiteHeader } from "@/components/SiteHeader";
import { DecisionBadge } from "@/components/ScoreBadge";
import { computeVerdictOutcomes, aggregateHitRate, GRADING_LAG_TRADING_DAYS, WATCH_NEUTRAL_BAND_PCT } from "@/lib/verdict-outcomes";
import type { Step8Result } from "@/lib/scoring/types";
import siteStyles from "@/styles/site.module.css";
import styles from "./page.module.css";

export const dynamic = "force-dynamic"; // 실현 수익률은 매일 바뀌므로 항상 최신 채점

function HitCell({ returnPct, hit }: { returnPct: number | null; hit: boolean | null }) {
  if (returnPct === null) return <span className={styles.pending}>채점 대기</span>;
  const sign = returnPct >= 0 ? "+" : "";
  return (
    <span className={hit === true ? styles.hit : hit === false ? styles.miss : styles.pending}>
      {sign}
      {returnPct}% {hit === true ? "✓ 적중" : hit === false ? "✗ 미적중" : ""}
    </span>
  );
}

export default async function TrackRecordPage() {
  const reports = await db.dailyReport.findMany({
    orderBy: { date: "desc" },
    take: 365,
    select: { date: true, marketDate: true, step8: true },
  });

  const verdicts = reports.map((report) => {
    const step8 = report.step8 as unknown as Step8Result;
    return {
      date: report.date.toISOString().slice(0, 10),
      marketDate: report.marketDate ? report.marketDate.toISOString().slice(0, 10) : null,
      finalDecision: step8.finalDecision,
    };
  });

  const outcomes = await computeVerdictOutcomes(verdicts);
  const hitRateSp500 = aggregateHitRate(outcomes, "hitSp500");
  const hitRateKospi = aggregateHitRate(outcomes, "hitKospi");
  const gradedCount = outcomes.filter((o) => o.hitSp500 !== null).length;

  return (
    <div className={siteStyles.page}>
      <SiteHeader current="track-record" />
      <div className={siteStyles.wrap} style={{ paddingTop: "1.5rem", paddingBottom: "3rem" }}>
        <h1 className={styles.title}>적중률(트랙레코드)</h1>
        <p className={styles.lead}>
          매일의 최종 결론(매수/지켜보기/현금비중늘리기)을 발행 {GRADING_LAG_TRADING_DAYS}거래일 뒤 실제
          S&P500·코스피 종가 변화와 코드가 자동으로 대조해 채점합니다. LLM이 스스로 &ldquo;적중&rdquo;을 판단하지
          않습니다 — &ldquo;매수&rdquo;는 상승, &ldquo;현금비중늘리기&rdquo;는 하락, &ldquo;지켜보기&rdquo;는 ±{WATCH_NEUTRAL_BAND_PCT}%
          이내 변동일 때 적중으로 셉니다.
        </p>
        <p className={styles.caveat}>
          ⚠ 2026년 7월 27일 운영 시작이라 표본이 아직 적습니다(채점 완료 {gradedCount}건). 이 수치를
          투자 신호의 신뢰도로 단정하지 말고 참고 자료로만 활용하세요.
        </p>

        <div className={styles.summaryRow}>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>S&P500 대비 적중률</div>
            <div className={styles.summaryValue}>{hitRateSp500 !== null ? `${hitRateSp500}%` : "채점 가능한 표본 없음"}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>코스피 대비 적중률</div>
            <div className={styles.summaryValue}>{hitRateKospi !== null ? `${hitRateKospi}%` : "채점 가능한 표본 없음"}</div>
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>날짜</th>
                <th>결론</th>
                <th>S&P500 ({GRADING_LAG_TRADING_DAYS}거래일)</th>
                <th>코스피 ({GRADING_LAG_TRADING_DAYS}거래일)</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((o) => (
                <tr key={o.date}>
                  <td>{o.date}</td>
                  <td>
                    <DecisionBadge decision={o.finalDecision as "매수" | "지켜보기" | "현금비중늘리기"} />
                  </td>
                  <td>
                    <HitCell returnPct={o.sp500ReturnPct} hit={o.hitSp500} />
                  </td>
                  <td>
                    <HitCell returnPct={o.kospiReturnPct} hit={o.hitKospi} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
