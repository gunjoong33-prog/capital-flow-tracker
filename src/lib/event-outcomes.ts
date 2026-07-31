import { getMetricHistory, getMetricHistoryByCount } from "@/lib/metrics";
import { METRICS } from "@/lib/sources/types";
import { getMajorEventsInRange } from "@/lib/major-events";

export interface EventOutcome {
  name: string;
  date: string;
  risky: boolean;
  detail: string;
  url?: string; // 원본 출처(예: FRED 시리즈 페이지) — "바로가기" 열에 표시
}

/**
 * 최근 N개 관측치 대비 최신 변화량의 z-score. |z| > threshold면 "서프라이즈"로 본다.
 * CPI·NFP·PPI·PCE는 전부 월간 지표라 "최근 400일" 같은 날짜창으로 가져오면 달마다 일수가 달라
 * periods+2(=14)개를 못 채우는 달이 생긴다(risingCheck/fallingCheck·calculatePercentile과 같은
 * 문제) — 날짜창 대신 "최근 N개 데이터포인트"로 가져와야 발표 지연과 무관하게 안정적으로 계산된다.
 */
async function zScoreSurprise(metric: string, periods: number, thresholdZ: number): Promise<{ risky: boolean; detail: string }> {
  const recent = await getMetricHistoryByCount(metric, periods + 1);
  if (recent.length < periods + 1) return { risky: false, detail: "데이터 부족(발표 반영 전이거나 이력 부족)" };
  const changes: number[] = [];
  for (let i = 1; i < recent.length; i++) changes.push(recent[i].value - recent[i - 1].value);
  const latestChange = changes[changes.length - 1];
  const baseline = changes.slice(0, -1);
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance = baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length;
  const std = Math.sqrt(variance);
  const z = std > 0 ? (latestChange - mean) / std : 0;
  const risky = Math.abs(z) > thresholdZ;
  return { risky, detail: `변화량 ${latestChange.toFixed(1)} (최근 ${periods}개월 대비 z=${z.toFixed(2)})` };
}

/**
 * 근원(Core) PCE의 실제 YoY/전월대비 값을 표기한다. 헤드라인 PCE(식품·에너지 포함)는 화면에 안 보여주고
 * BEA 원본 링크로 안내한다 — 연준이 실제로 목표(YoY 2%)로 삼는 건 근원 PCE라 서프라이즈 판정·표시 둘 다
 * 근원 기준으로 통일한다. z-score 계산도 같은 이력에서 한 번에 처리해 이중 조회를 피한다.
 */
async function corePceDetail(periods: number, thresholdZ: number): Promise<{ risky: boolean; detail: string; url: string }> {
  const url = "https://www.bea.gov/data/personal-consumption-expenditures-price-index";
  const history = await getMetricHistoryByCount(METRICS.US_PCE_CORE, periods + 2); // +1(YoY 비교용 12개월 전) +1(변화량 계산용)
  if (history.length < periods + 2) {
    return { risky: false, detail: "데이터 부족(발표 반영 전이거나 이력 부족)", url };
  }
  const changes: number[] = [];
  for (let i = 1; i < history.length; i++) changes.push(history[i].value - history[i - 1].value);
  const latestChange = changes[changes.length - 1];
  const baseline = changes.slice(0, -1);
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance = baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length;
  const std = Math.sqrt(variance);
  const z = std > 0 ? (latestChange - mean) / std : 0;
  const risky = Math.abs(z) > thresholdZ;

  const latest = history[history.length - 1];
  const prevMonth = history[history.length - 2];
  const yearAgo = history[history.length - 1 - 12];
  const yoy = ((latest.value - yearAgo.value) / yearAgo.value) * 100;
  const mom = ((latest.value - prevMonth.value) / prevMonth.value) * 100;
  const monthLabel = `${latest.date.getUTCFullYear()}년 ${latest.date.getUTCMonth() + 1}월`;
  const momSign = mom >= 0 ? "+" : "";
  return {
    risky,
    detail: `근원(Core) PCE YoY ${yoy.toFixed(2)}%, 전월대비 ${momSign}${mom.toFixed(2)}%(${monthLabel} 기준) — 헤드라인·세부 항목은 링크 참고`,
    url,
  };
}

/** FOMC는 "얼마나 놀랐는지"보다 "실제로 금리를 바꿨는지" 자체가 신호 — 동결이면 안전, 조금이라도 바뀌면 리스크로 본다. */
async function fedRateChanged(): Promise<{ risky: boolean; detail: string }> {
  const history = await getMetricHistory(METRICS.FED_FUNDS_RATE, 400);
  if (history.length < 2) return { risky: false, detail: "데이터 부족" };
  const [prev, curr] = history.slice(-2);
  const changed = curr.value !== prev.value;
  return { risky: changed, detail: changed ? `${prev.value}% → ${curr.value}%로 변경` : `${curr.value}%로 동결` };
}

/**
 * 지난 daysBack일 내 실제로 지나간 FOMC/CPI/고용지표 발표의 결과가 통계적으로 서프라이즈였는지 평가.
 * "이벤트가 예정돼 있다"가 아니라 "실제 발표 결과가 놀라웠다"를 거부권 판정 근거로 쓰기 위한 것 —
 * FOMC·CPI·고용지표를 다 캘린더에 넣으면 거의 매일 뭔가 예정돼 있어 거부권이 상시 발동하는 문제를 피한다.
 */
export async function evaluateRecentEventOutcomes(daysBack: number): Promise<EventOutcome[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - daysBack);
  const events = await getMajorEventsInRange(start, today);

  const outcomes: EventOutcome[] = [];
  for (const e of events) {
    let result: { risky: boolean; detail: string; url?: string };
    if (e.name.includes("CPI")) result = await zScoreSurprise(METRICS.US_CPI, 12, 1.5);
    else if (e.name.includes("고용지표")) result = await zScoreSurprise(METRICS.US_NFP, 12, 1.5);
    else if (e.name.includes("PPI")) result = await zScoreSurprise(METRICS.US_PPI, 12, 1.5);
    else if (e.name.includes("PCE")) result = await corePceDetail(12, 1.5);
    else if (e.name.includes("FOMC")) result = await fedRateChanged();
    else continue;

    outcomes.push({ name: e.name, date: e.date.toISOString().slice(0, 10), risky: result.risky, detail: result.detail, url: result.url });
  }
  return outcomes;
}
