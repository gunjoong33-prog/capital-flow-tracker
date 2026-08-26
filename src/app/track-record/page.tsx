import { db } from "@/lib/db";
import { SiteHeader } from "@/components/SiteHeader";
import { DecisionBadge } from "@/components/ScoreBadge";
import { HitRateDonut, HitTrendStrip } from "@/components/TrackRecordGraphs";
import {
  computeVerdictOutcomes,
  hitStats,
  GRADING_LAG_TRADING_DAYS,
  NEUTRAL_BAND_PCT,
} from "@/lib/verdict-outcomes";
import type { Step8Result } from "@/lib/scoring/types";
import { ibmPlexMono, mrsSaintDelafield } from "@/lib/site-fonts";
import siteStyles from "@/styles/site.module.css";
import styles from "./page.module.css";

export const dynamic = "force-dynamic"; // 실현 수익률은 매일 바뀌므로 항상 최신 채점

/** 등락률과 적중 여부를 분리해 보여준다. 예전엔 하나의 색(--pos/--neg)이 둘을 겸해서, 상승한 날
 *  (+11.49%)이 "미적중"이라는 이유로 하락색(빨강)으로 찍혔다 — 한국 투자자는 빨강을 상승으로
 *  읽으므로 정반대로 오독된다. 이제 숫자 색은 등락(빨강=상승/파랑=하락), 적중 여부는 배지가 맡는다. */
function HitCell({ returnPct, hit }: { returnPct: number | null; hit: boolean | null }) {
  if (returnPct === null) return <span className={styles.pending}>채점 대기</span>;
  const sign = returnPct >= 0 ? "+" : "";
  return (
    <span className={styles.hitCell}>
      <span className={returnPct >= 0 ? styles.up : styles.down}>
        {sign}
        {returnPct}%
      </span>
      {hit !== null && (
        <span className={hit ? styles.badgeHit : styles.badgeMiss}>{hit ? "✓ 적중" : "✗ 미적중"}</span>
      )}
    </span>
  );
}

function StatCard({
  label,
  stats,
}: {
  label: string;
  stats: { hits: number; graded: number; pct: number; ciLowPct: number; ciHighPct: number } | null;
}) {
  return (
    <div className={styles.summaryCard}>
      <div className={styles.summaryLabel}>{label}</div>
      {stats === null ? (
        <div className={styles.summaryValue}>채점 가능한 표본 없음</div>
      ) : (
        <div className={styles.summaryBody}>
          <HitRateDonut pct={stats.pct} />
          <div>
            <div className={styles.summaryValue}>
              {stats.hits}/{stats.graded}
              <span className={styles.summaryPct}>{stats.pct}%</span>
            </div>
            <div className={styles.summaryContext}>
              오차범위 {stats.ciLowPct}~{stats.ciHighPct}% · 동전 던지기 50%
            </div>
          </div>
        </div>
      )}
    </div>
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
  const spStats = hitStats(outcomes, "hitSp500");
  const koStats = hitStats(outcomes, "hitKospi");
  const asOfLabel = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className={`${siteStyles.page} ${ibmPlexMono.variable} ${mrsSaintDelafield.variable}`}>
      <SiteHeader current="track-record" />
      <div className={siteStyles.wrap} style={{ paddingTop: "1.5rem", paddingBottom: "3rem" }}>
        <h1 className={styles.title}>적중률(트랙레코드)</h1>

        <div className={styles.explainer}>
          <div className={styles.explainerRow}>
            <span className={styles.explainerTag}>채점 방식</span>
            <p className={styles.explainerText}>
              매일의 최종 결론(매수/지켜보기/현금비중늘리기)을 <strong>리포트가 다룬 미국장 거래일의
              다음 거래일 종가</strong>부터 {GRADING_LAG_TRADING_DAYS}거래일 뒤 종가와 코드가 자동으로
              대조해 채점합니다. 리포트는 기준 거래일 종가가 나온 뒤 발행되므로, 독자가 실제로 체결할
              수 있는 최초 가격에서 기산합니다. LLM이 스스로 &ldquo;적중&rdquo;을 판단하지 않습니다.
            </p>
          </div>
          <div className={styles.explainerRow}>
            <span className={styles.explainerTag}>적중 기준</span>
            <p className={styles.explainerText}>
              &ldquo;매수&rdquo;는 +{NEUTRAL_BAND_PCT}% 초과 상승, &ldquo;현금비중늘리기&rdquo;는 −
              {NEUTRAL_BAND_PCT}% 초과 하락, &ldquo;지켜보기&rdquo;는 ±{NEUTRAL_BAND_PCT}% 이내일 때
              적중입니다. 세 결론 모두 ±{NEUTRAL_BAND_PCT}% 안쪽 움직임은 <strong>사실상 보합</strong>으로
              보고 적중으로 세지 않습니다.
            </p>
          </div>
        </div>

        <p className={styles.caveat}>
          ⚠ 2026년 7월 27일 운영 시작이라 표본이 아직 적습니다. 아래 오차범위가 50%(동전 던지기)를
          포함하면 통계적으로 &ldquo;좋다/나쁘다&rdquo;를 말할 수 없는 구간입니다. 기준 시각 {asOfLabel} KST.
        </p>

        <div className={styles.summaryRow}>
          <StatCard label="S&P500 대비 적중" stats={spStats} />
          <StatCard label="코스피 대비 적중" stats={koStats} />
        </div>

        <div className="mb-6">
          <HitTrendStrip outcomes={outcomes} />
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.caption}>
              날짜는 리포트가 반영한 <strong>미국장 거래일</strong>입니다(발행은 다음 날 오전 9시 KST).
              한·미 휴장일이 다르면 지수별 기산일이 하루 어긋날 수 있어 각 셀에 실제 기산일을 표기합니다.
            </caption>
            <thead>
              <tr>
                <th scope="col">기준 거래일</th>
                <th scope="col">결론</th>
                <th scope="col">S&P500 ({GRADING_LAG_TRADING_DAYS}거래일)</th>
                <th scope="col">코스피 ({GRADING_LAG_TRADING_DAYS}거래일)</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((o) => (
                <tr key={o.date}>
                  <td>
                    {o.marketDate ?? o.date}
                    {o.marketDate && o.marketDate !== o.date && (
                      <span className={styles.subDate}>발행 {o.date}</span>
                    )}
                  </td>
                  <td>
                    <DecisionBadge decision={o.finalDecision as "매수" | "지켜보기" | "현금비중늘리기"} />
                  </td>
                  <td>
                    <HitCell returnPct={o.sp500ReturnPct} hit={o.hitSp500} />
                    {o.sp500AnchorDate && <span className={styles.subDate}>기산 {o.sp500AnchorDate}</span>}
                  </td>
                  <td>
                    <HitCell returnPct={o.kospiReturnPct} hit={o.hitKospi} />
                    {o.kospiAnchorDate && <span className={styles.subDate}>기산 {o.kospiAnchorDate}</span>}
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
