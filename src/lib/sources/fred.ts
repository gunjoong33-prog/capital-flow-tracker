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
  [METRICS.US_CPI]: "CPIAUCSL",
  [METRICS.US_NFP]: "PAYEMS",
  [METRICS.US_PPI]: "PPIFIS",
  [METRICS.US_PCE]: "PCEPI",
  [METRICS.FED_FUNDS_RATE]: "DFEDTARU",
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
  const points: FetchedPoint[] = [];
  const errors: { metric: string; message: string }[] = [];

  for (const metric of Object.keys(FRED_SERIES)) {
    try {
      const metricPoints = await fetchFredMetric(metric, apiKey, startDate);
      points.push(...metricPoints);
    } catch (err) {
      errors.push({
        metric,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { points, errors };
}
