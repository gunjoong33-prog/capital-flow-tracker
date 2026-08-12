// PR(ai-macro-company 성과추적팀)의 "적중률"이 실제로는 LLM 서술일 뿐이라는 지적을 근거로,
// 과거 판정(매수/지켜보기/현금비중늘리기)이 이후 실제 가격 변화와 맞았는지 코드가 채점한다.
// 사용자 확정: S&P500·KOSPI 둘 다 병행 채점.
import { fetchYahooHistorical } from "./sources/yahoo";
import { METRICS } from "./sources/types";

export const GRADING_LAG_TRADING_DAYS = 5; // 판정 발행 후 5거래일 뒤 가격과 대조
export const WATCH_NEUTRAL_BAND_PCT = 0.5; // "지켜보기"가 적중으로 인정되는 좁은 변동폭(±%)

export type PriceSeries = { date: string; value: number }[];

export interface VerdictOutcome {
  date: string;
  finalDecision: string;
  sp500ReturnPct: number | null;
  kospiReturnPct: number | null;
  hitSp500: boolean | null;
  hitKospi: boolean | null;
}

/**
 * 판정과 실현 수익률을 대조해 적중 여부를 정한다. "매수"는 상승, "현금비중늘리기"는 하락일 때
 * 적중, "지켜보기"는 변동폭이 좁을 때(±WATCH_NEUTRAL_BAND_PCT 이내) 적중으로 본다.
 * returnPct가 null(아직 N거래일이 안 지났거나 가격 데이터 없음)이면 판정도 null(모른다≠틀렸다).
 */
export function gradeHit(finalDecision: string, returnPct: number | null): boolean | null {
  if (returnPct === null) return null;
  if (finalDecision === "매수") return returnPct > 0;
  if (finalDecision === "현금비중늘리기") return returnPct < 0;
  if (finalDecision === "지켜보기") return Math.abs(returnPct) <= WATCH_NEUTRAL_BAND_PCT;
  return null;
}

/**
 * anchorDate(판정 기준일) 이후 첫 거래일 종가 대비, 거기서 GRADING_LAG_TRADING_DAYS거래일 뒤
 * 종가의 변화율(%). 시계열이 그 시점까지 안 쌓였으면(최근 판정) null.
 */
export function computeReturnPct(series: PriceSeries, anchorDate: string): number | null {
  const anchorIdx = series.findIndex((p) => p.date >= anchorDate);
  if (anchorIdx === -1) return null;
  const laterIdx = anchorIdx + GRADING_LAG_TRADING_DAYS;
  if (laterIdx >= series.length) return null;
  const base = series[anchorIdx].value;
  const later = series[laterIdx].value;
  if (base === 0) return null;
  return Math.round(((later - base) / base) * 10000) / 100;
}

/** 판정 목록 하나하나를 두 지수 시계열과 대조해 채점한다. */
export function gradeVerdicts(
  verdicts: { date: string; marketDate: string | null; finalDecision: string }[],
  sp500: PriceSeries | null,
  kospi: PriceSeries | null
): VerdictOutcome[] {
  return verdicts.map((v) => {
    const anchorDate = v.marketDate ?? v.date;
    const sp500ReturnPct = sp500 ? computeReturnPct(sp500, anchorDate) : null;
    const kospiReturnPct = kospi ? computeReturnPct(kospi, anchorDate) : null;
    return {
      date: v.date,
      finalDecision: v.finalDecision,
      sp500ReturnPct,
      kospiReturnPct,
      hitSp500: gradeHit(v.finalDecision, sp500ReturnPct),
      hitKospi: gradeHit(v.finalDecision, kospiReturnPct),
    };
  });
}

/** 채점된 것(null 제외) 중 적중 비율(%, 소수 1자리). 채점 가능한 게 하나도 없으면 null. */
export function aggregateHitRate(outcomes: VerdictOutcome[], key: "hitSp500" | "hitKospi"): number | null {
  const graded = outcomes.filter((o) => o[key] !== null);
  if (graded.length === 0) return null;
  const hits = graded.filter((o) => o[key] === true).length;
  return Math.round((hits / graded.length) * 1000) / 10;
}

/** Yahoo에서 S&P500·KOSPI 1년치를 가져와 판정들을 채점하는 오케스트레이션(네트워크 I/O 포함). */
export async function computeVerdictOutcomes(
  verdicts: { date: string; marketDate: string | null; finalDecision: string }[]
): Promise<VerdictOutcome[]> {
  const [sp500, kospi] = await Promise.all([
    fetchYahooHistorical(METRICS.SPX).catch(() => null),
    fetchYahooHistorical(METRICS.KOSPI).catch(() => null),
  ]);
  return gradeVerdicts(verdicts, sp500, kospi);
}
