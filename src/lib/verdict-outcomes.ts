// PR(ai-macro-company 성과추적팀)의 "적중률"이 실제로는 LLM 서술일 뿐이라는 지적을 근거로,
// 과거 판정(매수/지켜보기/현금비중늘리기)이 이후 실제 가격 변화와 맞았는지 코드가 채점한다.
// 사용자 확정: S&P500·KOSPI 둘 다 병행 채점.
import { fetchYahooHistorical } from "./sources/yahoo";
import { METRICS } from "./sources/types";

export const GRADING_LAG_TRADING_DAYS = 5; // 채점 기산일로부터 5거래일 뒤 가격과 대조
export const NEUTRAL_BAND_PCT = 0.5; // 세 결론 공통 — 이 안쪽 변동은 "사실상 보합"이라 적중으로 안 센다
/** @deprecated NEUTRAL_BAND_PCT로 통합됨(예전엔 "지켜보기"에만 적용됐다). 외부 참조 호환용. */
export const WATCH_NEUTRAL_BAND_PCT = NEUTRAL_BAND_PCT;

export type PriceSeries = { date: string; value: number }[];

export interface VerdictOutcome {
  date: string;
  marketDate: string | null;
  finalDecision: string;
  sp500ReturnPct: number | null;
  kospiReturnPct: number | null;
  hitSp500: boolean | null;
  hitKospi: boolean | null;
  /** 실제로 기산에 쓴 거래일(지수마다 휴장일이 달라 서로 다를 수 있다) — 화면에 규칙을 밝히기 위함. */
  sp500AnchorDate: string | null;
  kospiAnchorDate: string | null;
}

/**
 * 판정과 실현 수익률을 대조해 적중 여부를 정한다. "매수"는 상승, "현금비중늘리기"는 하락일 때
 * 적중, "지켜보기"는 변동폭이 좁을 때 적중으로 본다.
 *
 * 세 결론 모두에 ±NEUTRAL_BAND_PCT 무의미 구간을 적용한다 — 예전엔 "지켜보기"에만 밴드가 있어
 * -0.10% 같은 사실상 보합도 "현금비중늘리기 적중"으로 세어졌다(외부 감사 지적, 실제 확인:
 * S&P 적중 6건 중 3건이 -0.10/-0.11/-0.47%로 밴드 안쪽이었다). 수수료도 못 건지는 움직임을
 * 방향 예측 성공으로 세면 적중률이 실제보다 후하게 나온다.
 *
 * returnPct가 null(아직 N거래일이 안 지났거나 가격 데이터 없음)이면 판정도 null(모른다≠틀렸다).
 */
export function gradeHit(finalDecision: string, returnPct: number | null): boolean | null {
  if (returnPct === null) return null;
  if (finalDecision === "매수") return returnPct > NEUTRAL_BAND_PCT;
  if (finalDecision === "현금비중늘리기") return returnPct < -NEUTRAL_BAND_PCT;
  if (finalDecision === "지켜보기") return Math.abs(returnPct) <= NEUTRAL_BAND_PCT;
  return null;
}

/**
 * 채점 기산일 = anchorDate(리포트가 반영한 마지막 거래일) "다음" 거래일. 그 종가 대비
 * GRADING_LAG_TRADING_DAYS거래일 뒤 종가의 변화율(%).
 *
 * anchorDate 당일 종가를 쓰면 안 된다 — 리포트는 그 종가가 나온 뒤(09:00 KST = 전날 저녁 ET)에
 * 발행되므로, 독자가 실제로 체결할 수 있는 최초 시점은 다음 거래일이다. 당일 종가를 기산점으로
 * 잡으면 아무도 잡을 수 없는 밤사이 갭이 성과에 공짜로 들어간다(외부 감사·터미널 재조사 양쪽이
 * 독립적으로 지적). 시가 데이터가 없어 "다음 거래일 종가"로 근사한다 — 그 가격은 실제로 체결
 * 가능하므로 과대평가가 아니다.
 */
export function computeReturnPct(series: PriceSeries, anchorDate: string): number | null {
  const idx = anchorIndex(series, anchorDate);
  if (idx === -1) return null;
  const laterIdx = idx + GRADING_LAG_TRADING_DAYS;
  if (laterIdx >= series.length) return null;
  const base = series[idx].value;
  const later = series[laterIdx].value;
  if (base === 0) return null;
  return Math.round(((later - base) / base) * 10000) / 100;
}

/** 기산 인덱스 — anchorDate보다 "뒤"의 첫 거래일. 없으면 -1. */
export function anchorIndex(series: PriceSeries, anchorDate: string): number {
  return series.findIndex((p) => p.date > anchorDate);
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
    const at = (s: PriceSeries | null) => {
      if (!s) return null;
      const i = anchorIndex(s, anchorDate);
      return i === -1 ? null : s[i].date;
    };
    return {
      date: v.date,
      marketDate: v.marketDate,
      finalDecision: v.finalDecision,
      sp500ReturnPct,
      kospiReturnPct,
      hitSp500: gradeHit(v.finalDecision, sp500ReturnPct),
      hitKospi: gradeHit(v.finalDecision, kospiReturnPct),
      sp500AnchorDate: at(sp500),
      kospiAnchorDate: at(kospi),
    };
  });
}

/** 채점된 것(null 제외) 중 적중 비율(%, 소수 1자리). 채점 가능한 게 하나도 없으면 null. */
export function aggregateHitRate(outcomes: VerdictOutcome[], key: "hitSp500" | "hitKospi"): number | null {
  const s = hitStats(outcomes, key);
  return s === null ? null : s.pct;
}

/**
 * 적중 건수·분모·비율·95% 신뢰구간을 한 번에. 화면이 "37.5%"만 크게 띄우고 분모를 안 보여주던
 * 문제(외부 감사 지적) 때문에 추가 — 지수마다 휴장일이 달라 분모가 다르므로 지수별로 따로 낸다.
 * 신뢰구간은 Wilson score interval(표본이 작을 때 정규근사보다 정확).
 */
export function hitStats(
  outcomes: VerdictOutcome[],
  key: "hitSp500" | "hitKospi"
): { hits: number; graded: number; pct: number; ciLowPct: number; ciHighPct: number } | null {
  const graded = outcomes.filter((o) => o[key] !== null);
  if (graded.length === 0) return null;
  const n = graded.length;
  const hits = graded.filter((o) => o[key] === true).length;
  const p = hits / n;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  const r1 = (x: number) => Math.round(x * 1000) / 10;
  return {
    hits,
    graded: n,
    pct: r1(p),
    ciLowPct: r1(Math.max(0, center - half)),
    ciHighPct: r1(Math.min(1, center + half)),
  };
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
