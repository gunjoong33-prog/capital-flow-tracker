// Finnhub 무료 티어 — 매수~매도 등급 분포만 무료(목표주가는 Premium 전용이라 다루지 않는다).
export interface RecommendationTrend {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export async function fetchRecommendationTrend(
  ticker: string
): Promise<{ trend: RecommendationTrend | null; errors: string[] }> {
  const errors: string[] = [];
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    errors.push("Finnhub: FINNHUB_API_KEY 환경변수 없음");
    return { trend: null, errors };
  }
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${apiKey}`);
    if (!res.ok) throw new Error(`Finnhub 조회 실패: ${res.status}`);
    const body = (await res.json()) as RecommendationTrend[];
    if (body.length === 0) {
      errors.push(`Finnhub: ${ticker} 등급분포 데이터 없음`);
      return { trend: null, errors };
    }
    return { trend: body[0], errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { trend: null, errors };
  }
}
