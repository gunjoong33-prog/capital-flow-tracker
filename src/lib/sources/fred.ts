import { METRICS, type FetchedPoint } from "./types";

// FRED 시리즈 ID ↔ 우리 지표 ID 매핑.
// https://fred.stlouisfed.org/series/<id> 로 각 시리즈 확인 가능.
const FRED_SERIES: Record<string, string> = {
  [METRICS.WALCL]: "WALCL",
  [METRICS.M2]: "M2SL",
  // 기준잔액 기준이 "4주 연속"이라 월간 시리즈(TOTRESNS)가 아니라 주간 시리즈(WRESBAL)를 써야 한다.
  [METRICS.TOTRESNS]: "WRESBAL",
  [METRICS.RRP]: "RRPONTTLD",
  [METRICS.TGA]: "WTREGEN",
  [METRICS.REAL_RATE]: "REAINTRATREARAT10Y",
  [METRICS.CREDIT_SPREAD]: "BAMLH0A0HYM2",
  [METRICS.CREDIT_SPREAD_BBB]: "BAMLC0A4CBBB",
  [METRICS.US10Y]: "DGS10",
  [METRICS.US10Y_2Y10Y_SPREAD]: "T10Y2Y",
  [METRICS.US30Y]: "DGS30",
  [METRICS.US2Y]: "DGS2",
  [METRICS.US_CPI]: "CPIAUCSL",
  [METRICS.US_NFP]: "PAYEMS",
  [METRICS.US_PPI]: "PPIFIS",
  [METRICS.US_PCE]: "PCEPI",
  [METRICS.US_PCE_CORE]: "PCEPILFE",
  [METRICS.FED_FUNDS_RATE]: "DFEDTARU",
  // 아래 4개는 평소엔 Yahoo(yahoo.ts)가 당일 종가를 담당하고, 이건 Yahoo가 실패한 날에만
  // 쓰이는 폴백 공식 소스다(연준 H.10·EIA 원자료, 2~3영업일 지연). pipeline.ts에서 Yahoo 포인트를
  // FRED 포인트보다 나중에 저장해 같은 날짜가 겹치면 Yahoo 값이 이기도록 순서를 맞춰뒀다.
  [METRICS.USDKRW]: "DEXKOUS",
  [METRICS.USDJPY]: "DEXJPUS",
  [METRICS.WTI]: "DCOILWTICO",
  [METRICS.BRENT]: "DCOILBRENTEU",
};

interface FredObservation {
  date: string;
  value: string; // "." 이면 결측치
}

interface FredResponse {
  observations: FredObservation[];
}

/**
 * FRED API에서 한 시리즈의 값을 가져온다.
 * 무료 API 키 필요: https://fred.stlouisfed.org/docs/api/api_key.html
 * @param startDate 백필용, 없으면 최신값 위주로 가져옴
 */
async function fetchFredSeries(
  seriesId: string,
  apiKey: string,
  startDate?: string
): Promise<FredObservation[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    sort_order: "asc",
  });
  if (startDate) params.set("observation_start", startDate);

  const res = await fetch(
    `https://api.stlouisfed.org/fred/series/observations?${params}`
  );
  if (!res.ok) {
    throw new Error(`FRED ${seriesId} 요청 실패: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as FredResponse;
  return data.observations.filter((o) => o.value !== ".");
}

/** 우리 내부 지표 ID → FRED 시리즈 ID. event-outcomes.ts가 vintage 조회 시 재사용한다. */
export function getFredSeriesId(metric: string): string | undefined {
  return FRED_SERIES[metric];
}

/**
 * "그 시점에 실제로 알려졌던 값"(ALFRED vintage)을 가져온다 — realtime_start=realtime_end=asOf로
 * 고정하면 그 날짜 하루 동안 FRED가 서빙하던 스냅샷을 그대로 돌려준다.
 *
 * CPI·PPI·NFP·PCE 같은 지표는 발표 이후에도 다음 달 발표 때 직전 달 값이 조용히 개정된다(예: 2026년
 * 7월 고용보고서가 발표되며 5·6월 수치를 합산 -103,000 하향 수정) — 우리 DB(MetricValue)는 그냥
 * (지표, 관측월) 하나에 값 하나만 미러링해서, 나중에 재수집하면 그 개정치로 조용히 덮어써지거나
 * (반대로) 개정 전 값이 그대로 남아있게 된다. 두 경우 모두 "이번 달 신규 발표치"와 "직전 달 개정분"의
 * 시점이 어긋난 값끼리 비교하게 되어 변화량이 실제 헤드라인과 다르게 계산된다(실측: 2026년 7월
 * -23,000명이 맞는데 DB 값으로 단순 diff하면 -126,000명이 나옴 — 두 관측치가 서로 다른 vintage였기
 * 때문). 이 함수로 두 값을 반드시 "같은 realtime 날짜" 기준으로 같이 가져와야 그 날 발표문이 실제로
 * 말한 숫자와 일치한다.
 */
export async function fetchFredSeriesAsOf(
  seriesId: string,
  apiKey: string,
  asOf: Date,
  limit: number
): Promise<FredObservation[]> {
  const asOfStr = asOf.toISOString().slice(0, 10);
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    sort_order: "desc",
    limit: String(limit),
    realtime_start: asOfStr,
    realtime_end: asOfStr,
  });
  const res = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params}`);
  if (!res.ok) {
    throw new Error(`FRED ${seriesId} (asOf ${asOfStr}) 요청 실패: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as FredResponse;
  return data.observations.filter((o) => o.value !== ".").reverse(); // desc로 받은 걸 오래된 순으로
}

export async function fetchFredMetric(
  metric: string,
  apiKey: string,
  startDate?: string
): Promise<FetchedPoint[]> {
  const seriesId = FRED_SERIES[metric];
  if (!seriesId) {
    throw new Error(`${metric}에 대응하는 FRED 시리즈가 없다`);
  }
  const observations = await fetchFredSeries(seriesId, apiKey, startDate);
  return observations.map((o) => ({
    metric,
    date: o.date,
    value: parseFloat(o.value),
    source: "fred" as const,
  }));
}

export async function fetchAllFredMetrics(
  apiKey: string,
  startDate?: string
): Promise<{ points: FetchedPoint[]; errors: { metric: string; message: string }[] }> {
  // 지표별로 서로 독립적인 API 호출이라 순차 for 루프로 돌면 지표 개수만큼 왕복 지연이 그대로
  // 누적된다(파이프라인 55초 소요의 주요 원인 중 하나 — 외부 감사 지적, 실제 확인). 병렬로 바꾼다.
  const results = await Promise.allSettled(
    Object.keys(FRED_SERIES).map((metric) => fetchFredMetric(metric, apiKey, startDate))
  );

  const points: FetchedPoint[] = [];
  const errors: { metric: string; message: string }[] = [];
  const metrics = Object.keys(FRED_SERIES);
  results.forEach((r, i) => {
    if (r.status === "fulfilled") points.push(...r.value);
    else errors.push({ metric: metrics[i], message: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  });

  return { points, errors };
}
