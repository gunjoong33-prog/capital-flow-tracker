import { getMetricHistory, getMetricHistoryByCount } from "@/lib/metrics";
import { METRICS } from "@/lib/sources/types";
import { getMajorEventsInRange } from "@/lib/major-events";

export interface EventOutcome {
  name: string;
  date: string;
  // null = 판정불가(데이터 부족) — "서프라이즈 아님"(false)과 구분해야 한다. 데이터가 없다고
  // "안전하다"로 기본값 처리하면(fail-open) 화재경보기 배터리가 없을 때 "화재 없음"으로 표시하는
  // 것과 같다 — 모르면 모른다고 표시해야 한다(데이터 정직성 원칙).
  risky: boolean | null;
  detail: string;
  url?: string; // 원본 출처(예: FRED 시리즈 페이지) — "바로가기" 열에 표시
}

/**
 * 최근 N개 관측치 대비 최신 변화량의 z-score.
 * CPI·NFP·PPI·PCE는 전부 월간 지표라 "최근 400일" 같은 날짜창으로 가져오면 달마다 일수가 달라
 * periods+2(=14)개를 못 채우는 달이 생긴다(risingCheck/fallingCheck·calculatePercentile과 같은
 * 문제) — 날짜창 대신 "최근 N개 데이터포인트"로 가져와야 발표 지연과 무관하게 안정적으로 계산된다.
 *
 * onlyHotSurprise: true면 z > threshold(예상보다 더 뜨거워짐)일 때만 risky, false면 |z| > threshold
 * (방향 무관)로 risky를 판정한다. 물가 지표(CPI·PPI)는 "예상보다 덜 오름(디스인플레이션)"이 통상
 * 주식시장에 우호적 서프라이즈라 그것까지 리스크로 잡으면 방향이 반대로 잡힌다 — true를 쓴다.
 * 고용지표(NFP)는 "예상보다 잘 나옴"이 국면에 따라 호재·악재가 뒤집혀서(굿뉴스가 배드뉴스인 시기가
 * 있음) 한쪽 방향으로 고정하는 게 더 위험하다고 판단해 false(방향 무관)를 유지한다.
 */
async function zScoreSurprise(
  metric: string,
  periods: number,
  thresholdZ: number,
  onlyHotSurprise: boolean,
  asOf: Date = new Date()
): Promise<{ risky: boolean | null; detail: string }> {
  const recent = await getMetricHistoryByCount(metric, periods + 1, asOf);
  if (recent.length < periods + 1) return { risky: null, detail: "데이터 부족(발표 반영 전이거나 이력 부족) — 판정불가" };
  const changes: number[] = [];
  for (let i = 1; i < recent.length; i++) changes.push(recent[i].value - recent[i - 1].value);
  const latestChange = changes[changes.length - 1];
  const baseline = changes.slice(0, -1);
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance = baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length;
  const std = Math.sqrt(variance);
  const z = std > 0 ? (latestChange - mean) / std : 0;
  const risky = onlyHotSurprise ? z > thresholdZ : Math.abs(z) > thresholdZ;
  return { risky, detail: `변화량 ${latestChange.toFixed(1)} (최근 ${periods}개월 대비 z=${z.toFixed(2)})` };
}

/**
 * 근원(Core) PCE의 실제 YoY/전월대비 값을 표기한다. 헤드라인 PCE(식품·에너지 포함)는 화면에 안 보여주고
 * BEA 원본 링크로 안내한다 — 연준이 실제로 목표(YoY 2%)로 삼는 건 근원 PCE라 서프라이즈 판정·표시 둘 다
 * 근원 기준으로 통일한다. z-score 계산도 같은 이력에서 한 번에 처리해 이중 조회를 피한다.
 * CPI·PPI와 같은 이유로 "예상보다 덜 오름(z가 음수)"은 리스크로 잡지 않는다 — z > threshold(예상보다
 * 더 뜨거워짐)일 때만 risky로 본다.
 */
async function corePceDetail(
  periods: number,
  thresholdZ: number,
  asOf: Date = new Date()
): Promise<{ risky: boolean | null; detail: string; url: string }> {
  const url = "https://www.bea.gov/data/personal-consumption-expenditures-price-index";
  const history = await getMetricHistoryByCount(METRICS.US_PCE_CORE, periods + 2, asOf); // +1(YoY 비교용 12개월 전) +1(변화량 계산용)
  if (history.length < periods + 2) {
    return { risky: null, detail: "데이터 부족(발표 반영 전이거나 이력 부족) — 판정불가", url };
  }
  const changes: number[] = [];
  for (let i = 1; i < history.length; i++) changes.push(history[i].value - history[i - 1].value);
  const latestChange = changes[changes.length - 1];
  const baseline = changes.slice(0, -1);
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance = baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length;
  const std = Math.sqrt(variance);
  const z = std > 0 ? (latestChange - mean) / std : 0;
  const risky = z > thresholdZ;

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

/**
 * FOMC 성명서 원문에서 반대표(dissent) 인원을 파싱한다. 실제 성명서는 예:
 * "...approved the following statement for release by a 9 – 3 vote..."처럼 표결 집계를 그대로
 * 텍스트에 담고 있다 — "동결/변경 여부"만으로는 못 잡는 "사실은 다수가 인상/인하를 원했다"는
 * 매파적/비둘기파적 신호를 여기서 뽑아낸다.
 * 반대자 이름 목록("Voting against... were A, B, and C")을 직접 세는 방식은 이름에 중간이니셜
 * 마침표가 섞여 있어("Beth M. Hammack") 정규식이 문장 끝으로 오인하기 쉽다 — 대신 투표 집계
 * 숫자 자체("9 – 3 vote")를 반대표 수의 근거로 쓴다. 원문 파싱이라 문구가 조금만 바뀌어도 실패할
 * 수 있어 실패 시 조용히 null을 돌려주고(데이터 정직성 원칙), 기존 동결/변경 판정에는 영향을
 * 주지 않는다.
 */
async function fetchFomcDissentCount(meetingDate: Date): Promise<{ dissentCount: number | null; url: string }> {
  const dateStr = meetingDate.toISOString().slice(0, 10).replace(/-/g, "");
  const url = `https://www.federalreserve.gov/newsevents/pressreleases/monetary${dateStr}a.htm`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (capital-flow-tracker personal use)" } });
    if (!res.ok) return { dissentCount: null, url };
    const html = await res.text();
    const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    // "by a 9 – 3 vote" / "by a 9-3 vote" 둘 다 매칭(구두점이 en-dash·hyphen 둘 다 쓰일 수 있음).
    const voteMatch = text.match(/by a (\d+)\s*[–‒-]\s*(\d+) vote/);
    if (!voteMatch) return { dissentCount: null, url }; // 표결 집계 문구를 못 찾으면 판정 보류
    return { dissentCount: parseInt(voteMatch[2], 10), url };
  } catch {
    return { dissentCount: null, url };
  }
}

/**
 * FOMC는 "얼마나 놀랐는지"보다 "실제로 금리를 바꿨는지" 자체가 우선 신호지만, 동결이어도 다수가
 * 반대(인상/인하를 원함)했다면 매파적/비둘기파적 서프라이즈로 봐야 한다 — "9-3 표결로 동결"은
 * "만장일치 동결"과 시장에 주는 신호가 다르다. 반대표 2명 이상이면 risky로 취급한다(관례상
 * FOMC 표결은 대개 만장일치에 가까워, 2명 이상 반대는 이례적인 수준).
 */
async function fedRateChanged(
  meetingDate: Date,
  asOf: Date = new Date()
): Promise<{ risky: boolean | null; detail: string; url?: string }> {
  const history = await getMetricHistory(METRICS.FED_FUNDS_RATE, 400, asOf);
  if (history.length < 2) return { risky: null, detail: "데이터 부족 — 판정불가" };
  const [prev, curr] = history.slice(-2);
  const changed = curr.value !== prev.value;

  const { dissentCount, url } = await fetchFomcDissentCount(meetingDate);
  const dissentRisky = dissentCount !== null && dissentCount >= 2;
  const dissentNote = dissentCount === null
    ? ""
    : dissentCount === 0
      ? "(만장일치)"
      : `(반대표 ${dissentCount}명)`;

  // METRICS.FED_FUNDS_RATE는 FRED DFEDTARU(목표범위 상단)만 저장한다 — "동결/변경" 판정에는 상단
  // 값 비교만으로 충분하지만, 그대로 "curr.value%로 동결"이라고 표시하면 실제로는 범위(폭 0.25%p
  // 고정)인데 상단 하나만 보여주는 값처럼 오인된다(외부 교차검증 지적). 연준이 2008년 범위제 도입
  // 이후 목표범위 폭을 항상 25bp로 유지해온 관례를 이용해 하단을 역산해 범위 전체를 표시한다.
  const rangeLabel = (upper: number) => `${(upper - 0.25).toFixed(2)}~${upper.toFixed(2)}%`;
  return {
    risky: changed || dissentRisky,
    detail: `${changed ? `${rangeLabel(prev.value)} → ${rangeLabel(curr.value)}로 변경` : `${rangeLabel(curr.value)}로 동결`}${dissentNote}`,
    url,
  };
}

/**
 * 지난 daysBack일 내 실제로 지나간 FOMC/CPI/고용지표 발표의 결과가 통계적으로 서프라이즈였는지 평가.
 * "이벤트가 예정돼 있다"가 아니라 "실제 발표 결과가 놀라웠다"를 거부권 판정 근거로 쓰기 위한 것 —
 * FOMC·CPI·고용지표를 다 캘린더에 넣으면 거의 매일 뭔가 예정돼 있어 거부권이 상시 발동하는 문제를 피한다.
 */
export async function evaluateRecentEventOutcomes(daysBack: number, asOf: Date = new Date()): Promise<EventOutcome[]> {
  const today = new Date(asOf);
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - daysBack);
  const events = await getMajorEventsInRange(start, today);

  const outcomes: EventOutcome[] = [];
  for (const e of events) {
    let result: { risky: boolean | null; detail: string; url?: string };
    if (e.name.includes("CPI")) result = await zScoreSurprise(METRICS.US_CPI, 12, 1.5, true, asOf);
    else if (e.name.includes("고용지표")) result = await zScoreSurprise(METRICS.US_NFP, 12, 1.5, false, asOf);
    else if (e.name.includes("PPI")) result = await zScoreSurprise(METRICS.US_PPI, 12, 1.5, true, asOf);
    else if (e.name.includes("PCE")) result = await corePceDetail(12, 1.5, asOf);
    else if (e.name.includes("FOMC")) result = await fedRateChanged(e.date, asOf);
    else continue;

    outcomes.push({ name: e.name, date: e.date.toISOString().slice(0, 10), risky: result.risky, detail: result.detail, url: result.url });
  }
  return outcomes;
}
