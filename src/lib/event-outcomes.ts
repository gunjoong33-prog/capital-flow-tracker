import { getMetricHistory, getMetricHistoryByCount } from "@/lib/metrics";
import { METRICS } from "@/lib/sources/types";
import { getMajorEventsInRange } from "@/lib/major-events";
import { fetchFredSeriesAsOf, getFredSeriesId } from "@/lib/sources/fred";

/**
 * CPI·PPI·NFP·PCE처럼 다음 달 발표 때 직전 달 값이 조용히 개정되는 지표는, 우리 DB(MetricValue)에
 * 미러링된 "그때그때 마지막으로 저장된 값"을 그냥 diff하면 서로 다른 시점(vintage)의 값끼리 비교하게
 * 될 위험이 있다(실측: 2026년 7월 고용보고서가 6월 수치를 하향 개정하면서, DB에 남아있던 개정 전
 * 6월 값과 새 7월 값을 단순 diff하면 실제 헤드라인(-23,000명)과 다른 -126,000명이 나왔다). FRED의
 * realtime_start=realtime_end=asOf 파라미터로 "그 날짜에 실제로 알려졌던 값"을 매번 다시 가져오면
 * 두 값이 항상 같은 vintage라 정확한 헤드라인 변화량과 일치한다. FRED_API_KEY가 없거나 조회에
 * 실패하면 null을 돌려주고 호출부가 "판정불가"로 처리한다(데이터 정직성 원칙 — 실패를 조용히
 * DB 미러값으로 우회하지 않는다).
 */
async function fetchVintageAccurate(
  metric: string,
  count: number,
  asOf: Date
): Promise<{ date: Date; value: number }[] | null> {
  const apiKey = process.env.FRED_API_KEY;
  const seriesId = getFredSeriesId(metric);
  if (!apiKey || !seriesId) return null;
  try {
    const obs = await fetchFredSeriesAsOf(seriesId, apiKey, asOf, count);
    return obs.map((o) => ({ date: new Date(o.date), value: parseFloat(o.value) }));
  } catch {
    return null;
  }
}

/**
 * fetchVintageAccurate가 "실패"(null)한 게 아니라 "성공했지만 필요한 개수보다 적게" 돌려주는 경우가
 * 있다 — 실측(2026-08-13): 2025-10 CPI가 정부 셧다운 여파로 FRED 자체에 통째로 결측이라, asOf
 * 기준 최근 13개를 요청해도 vintage 조회는 항상 12개만 돌려준다. 기존엔 `?? `(null만 걸러냄)라서
 * 이 경우 DB 폴백을 아예 안 타고 그대로 "데이터 부족"으로 오판정했다. DB는 더 깊은 백필 이력이 있어
 * 그 결손 한 달을 우회하고도 필요한 개수를 채울 수 있으니, 길이가 부족하면 DB도 시도해 더 긴 쪽을
 * 쓴다 — 그래도 둘 다 부족하면 호출부가 정직하게 "데이터 부족"으로 판정하게 그대로 둔다.
 */
async function fetchHistoryWithFallback(
  metric: string,
  count: number,
  asOf: Date
): Promise<{ date: Date; value: number }[]> {
  const vintage = await fetchVintageAccurate(metric, count, asOf);
  if (vintage && vintage.length >= count) return vintage;
  const dbFallback = await getMetricHistoryByCount(metric, count, asOf);
  if (dbFallback.length >= count) return dbFallback;
  return (vintage?.length ?? 0) >= dbFallback.length ? vintage! : dbFallback;
}

export interface EventOutcome {
  name: string;
  date: string;
  // null = 판정불가(데이터 부족) — "서프라이즈 아님"(false)과 구분해야 한다. 데이터가 없다고
  // "안전하다"로 기본값 처리하면(fail-open) 화재경보기 배터리가 없을 때 "화재 없음"으로 표시하는
  // 것과 같다 — 모르면 모른다고 표시해야 한다(데이터 정직성 원칙).
  risky: boolean | null;
  detail: string;
  url?: string; // 원본 출처(예: FRED 시리즈 페이지) — "바로가기" 열에 표시
  // CPI처럼 한 발표에서 헤드라인·근원 두 줄을 따로 보여줄 때 행 라벨에 붙이는 구분자(예: "(헤드라인)").
  // name·date는 원래 이벤트 이름 그대로 유지해야 run.ts의 "이미 결과 나온 이벤트는 예정 목록에서
  // 제외" 중복제거 키(name|date)가 안 깨진다.
  subLabel?: string;
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
  asOf: Date = new Date(),
  // 종합 보고서 LLM이 이 detail 문자열을 그대로 인용하는데, 원래는 단위 없이 raw 숫자만 줘서
  // NFP(FRED PAYEMS, 실제로는 "천 명" 단위)를 LLM이 이미 "명" 단위인 것처럼 잘못 해석해 엉뚱한
  // 배율로 서술한 사례가 실제로 있었다(-23.0(천 명) → "-126,000명"으로 서술). 지표별로 사람이 읽는
  // 최종 단위(명)까지 미리 환산해 옮겨적기만 하면 되게 한다 — 계산을 LLM에 맡기지 않는다.
  formatChange: (change: number) => string = (v) => v.toFixed(1)
): Promise<{ risky: boolean | null; detail: string }> {
  const recent = await fetchHistoryWithFallback(metric, periods + 1, asOf);
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
  return { risky, detail: `변화량 ${formatChange(latestChange)} (최근 ${periods}개월 대비 z=${z.toFixed(2)})` };
}

/**
 * history에서 baseDate 기준 정확히 monthsBack개월 전 값을 "카운트 위치"가 아니라 "달력 날짜"로
 * 찾는다. 결측월(예: 2025-10 CPI, 정부 셧다운으로 그 달만 통째로 안 나옴)이 창 안에 끼어 있으면
 * "최근 N개" 카운트 인덱싱은 조용히 한 달 더 밀려서 12개월 전이 아니라 13개월 전과 비교하게 된다
 * (실측 2026-08-13: 헤드라인 CPI YoY가 3.52%로 계산됐는데 실제 BLS·언론 보도치는 3.4% — PPI는
 * 같은 코드로도 정확히 맞았는데(4.69%≈4.7%), PPI 시리즈엔 그 결측월이 없어서 우연히 안 걸렸을
 * 뿐이었다). 달력 매칭이면 결측월이 몇 개 끼어도 항상 정확히 monthsBack개월 전을 찾는다.
 */
function findMonthsBefore(history: { date: Date; value: number }[], baseDate: Date, monthsBack: number): number | null {
  const target = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() - monthsBack, 1));
  const found = history.find((h) => h.date.getUTCFullYear() === target.getUTCFullYear() && h.date.getUTCMonth() === target.getUTCMonth());
  return found ? found.value : null;
}

/**
 * 물가지수(CPI·PPI·PCE 등) 공통 — YoY·전월대비(%)를 사람이 실제로 물가지표를 읽는 방식대로 계산해
 * 표기한다. 예전엔 CPI·PPI만 원지수 변화량+z-score("변화량 0.2 (z=-0.76)")로, PCE만 YoY/MoM(%)로
 * 서로 다르게 표기했는데, 사용자가 셋 다 이 형식으로 통일해달라고 요청해 하나의 함수로 합쳤다
 * ([[헤드라인/근원 CPI 병기 요청]] 2026-08-13). z-score는 전월대비 변화량의 최근 분포 기준(기존
 * zScoreSurprise와 동일 계산), "예상보다 덜 오름(디스인플레이션)"은 CPI·PPI·PCE 공통 관례대로
 * risky로 안 잡는다(z > threshold, 즉 예상보다 더 뜨거워질 때만 risky).
 *
 * yoyMetric: BLS 관례상 CPI·PPI의 "전년동월대비(YoY)" 헤드라인 수치는 비계절조정(NSA) 지수로
 * 계산하고, 전월대비(MoM)만 계절조정(SA) 지수를 쓴다(PCE는 반대로 YoY도 BEA가 SA로 발표) — 실측
 * (2026-08-13): metric(SA)만으로 CPI YoY를 계산하니 3.54%가 나왔는데 실제 BLS·언론 보도치는
 * 3.4%(NSA 기준)였다. 생략하면 metric과 동일한 지표로 YoY도 계산한다(PCE처럼 SA로 충분한 경우).
 */
async function priceIndexDetail(
  metric: string,
  periods: number,
  thresholdZ: number,
  asOf: Date,
  yoyMetric: string = metric
): Promise<{ risky: boolean | null; detail: string }> {
  // +1(전월대비 계산용) +1(z-score 기준선용) — z-score·전월대비는 최근 구간이라 결측월과 안 겹침.
  const history = await fetchHistoryWithFallback(metric, periods + 2, asOf);
  if (history.length < periods + 2) {
    return { risky: null, detail: "데이터 부족(발표 반영 전이거나 이력 부족) — 판정불가" };
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
  const mom = ((latest.value - prevMonth.value) / prevMonth.value) * 100;
  const monthLabel = `${latest.date.getUTCFullYear()}년 ${latest.date.getUTCMonth() + 1}월`;
  const momSign = mom >= 0 ? "+" : "";

  // YoY는 결측월을 우회할 여유(+6개월 버퍼)를 두고 findMonthsBefore로 달력상 정확히 12개월 전을 찾는다.
  const yoyHistory = await fetchHistoryWithFallback(yoyMetric, periods + 6, asOf);
  const yoyLatest = yoyHistory[yoyHistory.length - 1];
  const yearAgoValue = yoyLatest ? findMonthsBefore(yoyHistory, yoyLatest.date, 12) : null;
  const yoy = yearAgoValue !== null && yoyLatest ? ((yoyLatest.value - yearAgoValue) / yearAgoValue) * 100 : null;

  if (yoy === null) {
    return { risky, detail: `전월대비 ${momSign}${mom.toFixed(2)}%(${monthLabel} 기준) — YoY 데이터 부족` };
  }
  return {
    risky,
    detail: `YoY ${yoy.toFixed(2)}%, 전월대비 ${momSign}${mom.toFixed(2)}%(${monthLabel} 기준)`,
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
  // "오늘"을 UTC로 자르면 KST 00~09시(=UTC 15~24시, 전날 UTC 날짜) 실행 시 하루 어긋난다 —
  // date.ts의 kstToday() 주석과 같은 문제. 리포트는 KST 기준 "오늘 아침"에 생성되므로 KST 달력
  // 날짜로 today를 계산해야 한다(처음엔 UTC로 잘랐다가, 8/8 리포트(생성 시각 UTC 23:52=KST 08:52,
  // 즉 KST로는 이미 8/8)에서 전날(8/7 KST, 이미 발표된) 고용지표까지 통째로 빠지는 걸 실측하고 수정).
  const todayKstStr = asOf.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const today = new Date(`${todayKstStr}T00:00:00.000Z`);
  // 종료 경계를 "오늘"이 아니라 "어제"까지로 잡는다 — 예전엔 오늘 날짜인 이벤트(예: 그날 저녁 발표될
  // 고용지표)를 asOf의 실제 시각과 무관하게 무조건 "이미 지난 결과"로 취급해, 아직 발표 전인데도
  // "실제 결과"란에 무의미한 값이 찍히는 사례가 실제로 있었다(8/7 리포트, 생성 시각이 발표 시각보다
  // 12시간 이상 앞섰는데도 결과가 표시됨). 이 앱이 다루는 이벤트는 전부 리포트 생성 시각(한국 아침
  // 9시)보다 늦게 발표되므로, "오늘은 항상 제외"로 안전하게 하루 늦춘다.
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - daysBack);
  const events = await getMajorEventsInRange(start, end);

  const outcomes: EventOutcome[] = [];
  for (const e of events) {
    const dateStr = e.date.toISOString().slice(0, 10);
    // vintage 정확도가 중요한 지표들(CPI·NFP·PPI·PCE)은 report asOf가 아니라 이벤트가 실제로 발표된
    // 그 날짜(e.date)를 기준으로 FRED에 그 시점 스냅샷을 물어봐야 한다 — report asOf를 쓰면 리포트
    // 생성이 발표일보다 며칠 늦게 재구성되는 경우(백필 등) 그사이 또 다른 개정이 끼어들 수 있다.
    if (e.name.includes("CPI")) {
      // 헤드라인·근원 CPI를 한 줄에 억지로 합치지 않고 별도 행 두 개로 나눈다 — 사용자 요청
      // (2026-08-13): "헤드라인 cpi, core cpi yoy,mom으로 표기, 기준에 따라 충족값 표기(v,x)".
      // name·date는 원래 이벤트("미국 CPI 발표")로 유지해 중복제거 키가 안 깨지게 하고, subLabel로만
      // 행 라벨을 구분한다(run.ts가 `${o.name}${o.subLabel}(...)` 형태로 조립).
      const headline = await priceIndexDetail(METRICS.US_CPI, 12, 1.5, e.date, METRICS.US_CPI_NSA);
      const core = await priceIndexDetail(METRICS.US_CPI_CORE, 12, 1.5, e.date, METRICS.US_CPI_CORE_NSA);
      outcomes.push({ name: e.name, date: dateStr, risky: headline.risky, detail: headline.detail, subLabel: "(헤드라인)" });
      outcomes.push({ name: e.name, date: dateStr, risky: core.risky, detail: core.detail, subLabel: "(근원)" });
      continue;
    }

    let result: { risky: boolean | null; detail: string; url?: string };
    // US_NFP(FRED PAYEMS)는 "천 명" 단위 레벨값이라 전월 대비 변화량도 천 명 단위다 — 물가지수가
    // 아니라 YoY/MoM(%) 표기 대상이 아니므로 zScoreSurprise를 그대로 유지한다.
    if (e.name.includes("고용지표"))
      result = await zScoreSurprise(METRICS.US_NFP, 12, 1.5, false, e.date, (v) => `${Math.round(v * 1000).toLocaleString("en-US")}명`);
    else if (e.name.includes("PPI")) result = await priceIndexDetail(METRICS.US_PPI, 12, 1.5, e.date, METRICS.US_PPI_NSA);
    else if (e.name.includes("PCE")) {
      const core = await priceIndexDetail(METRICS.US_PCE_CORE, 12, 1.5, e.date);
      // 헤드라인 PCE(식품·에너지 포함)는 화면에 안 보여주고 BEA 원본 링크로 안내한다 — 연준이 실제로
      // 목표(YoY 2%)로 삼는 건 근원 PCE라 서프라이즈 판정·표시 둘 다 근원 기준으로 통일한다.
      result = { risky: core.risky, detail: `근원(Core) PCE ${core.detail} — 헤드라인·세부 항목은 링크 참고`, url: "https://www.bea.gov/data/personal-consumption-expenditures-price-index" };
    }
    else if (e.name.includes("FOMC")) result = await fedRateChanged(e.date, asOf);
    else continue;

    outcomes.push({ name: e.name, date: dateStr, risky: result.risky, detail: result.detail, url: result.url });
  }
  return outcomes;
}
