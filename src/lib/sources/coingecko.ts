import { METRICS, type FetchedPoint } from "./types";
import { kstToday } from "@/lib/date";

// CoinGecko 무료 API. 인증 불필요(공개 엔드포인트, 레이트리밋 있음).
const COIN_IDS: Record<string, string> = {
  [METRICS.BTC]: "bitcoin",
  [METRICS.ETH]: "ethereum",
};

interface MarketChartResponse {
  prices: [number, number][]; // [unix_ms, price]
}

function toDateString(unixMs: number): string {
  return new Date(unixMs).toISOString().slice(0, 10);
}

/**
 * 지정 기간의 일별 종가를 가져온다. 백필용.
 * CoinGecko는 90일 초과 조회 시 자동으로 일봉 간격을 준다.
 */
export async function fetchCoinGeckoRange(
  metric: string,
  fromDate: Date,
  toDate: Date = new Date()
): Promise<FetchedPoint[]> {
  const coinId = COIN_IDS[metric];
  if (!coinId) throw new Error(`${metric}은 CoinGecko 대상이 아니다`);

  const params = new URLSearchParams({
    vs_currency: "usd",
    from: String(Math.floor(fromDate.getTime() / 1000)),
    to: String(Math.floor(toDate.getTime() / 1000)),
  });

  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?${params}`
  );
  if (!res.ok) {
    throw new Error(`CoinGecko ${coinId} 요청 실패: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as MarketChartResponse;

  // 하루에 여러 포인트가 올 수 있어 날짜별 마지막 값만 남긴다(그날의 종가 취급).
  const byDate = new Map<string, number>();
  for (const [ts, price] of data.prices) {
    byDate.set(toDateString(ts), price);
  }

  return Array.from(byDate.entries()).map(([date, value]) => ({
    metric,
    date,
    value,
    source: "coingecko" as const,
  }));
}

/** 오늘 시세 하나만 빠르게 가져올 때(매일 파이프라인용). */
export async function fetchCoinGeckoLatest(): Promise<FetchedPoint[]> {
  const params = new URLSearchParams({
    ids: "bitcoin,ethereum",
    vs_currencies: "usd",
  });
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?${params}`);
  if (!res.ok) {
    throw new Error(`CoinGecko 시세 요청 실패: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as Record<string, { usd: number }>;
  const today = kstToday();

  return [
    { metric: METRICS.BTC, date: today, value: data.bitcoin.usd, source: "coingecko" as const },
    { metric: METRICS.ETH, date: today, value: data.ethereum.usd, source: "coingecko" as const },
  ];
}
