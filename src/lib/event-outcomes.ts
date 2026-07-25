import { getMetricHistory } from "@/lib/metrics";
import { METRICS } from "@/lib/sources/types";
import { getMajorEventsInRange } from "@/lib/major-events";

export interface EventOutcome {
  name: string;
  date: string;
  risky: boolean;
  detail: string;
}

/** 최근 N개 관측치 대비 최신 변화량의 z-score. |z| > threshold면 "서프라이즈"로 본다. */
async function zScoreSurprise(metric: string, periods: number, thresholdZ: number): Promise<{ risky: boolean; detail: string }> {
  const history = await getMetricHistory(metric, 400);
  if (history.length < periods + 2) return { risky: false, detail: "데이터 부족(발표 반영 전이거나 이력 부족)" };
  const recent = history.slice(-(periods + 1));
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
    let result: { risky: boolean; detail: string };
    if (e.name.includes("CPI")) result = await zScoreSurprise(METRICS.US_CPI, 12, 1.5);
    else if (e.name.includes("고용지표")) result = await zScoreSurprise(METRICS.US_NFP, 12, 1.5);
    else if (e.name.includes("PPI")) result = await zScoreSurprise(METRICS.US_PPI, 12, 1.5);
    else if (e.name.includes("PCE")) result = await zScoreSurprise(METRICS.US_PCE, 12, 1.5);
    else if (e.name.includes("FOMC")) result = await fedRateChanged();
    else continue;

    outcomes.push({ name: e.name, date: e.date.toISOString().slice(0, 10), risky: result.risky, detail: result.detail });
  }
  return outcomes;
}
