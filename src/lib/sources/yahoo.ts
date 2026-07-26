import { METRICS, SECTOR_ETFS, SECTOR_LABELS, type FetchedPoint } from "./types";

// Yahoo Finance 비공식 차트 API. 무료, 키 불필요.
// 공식 API가 아니므로 예고 없이 바뀌거나 막힐 수 있다 — 실패 시 "확인 못함"으로 처리하고
// 절대 숫자를 지어내지 않는다(v2 프롬프트 원칙과 동일하게 적용).
const YAHOO_TICKERS: Record<string, string> = {
  [METRICS.GOLD]: "GC=F",
  [METRICS.WTI]: "CL=F",
  [METRICS.BRENT]: "BZ=F",
  [METRICS.USDKRW]: "KRW=X",
  [METRICS.USDJPY]: "JPY=X",
  [METRICS.NDX]: "^NDX",
  [METRICS.RUT]: "^RUT",
  [METRICS.DJI]: "^DJI",
  [METRICS.SPX]: "^GSPC",
  [METRICS.VIX]: "^VIX",
  [METRICS.AAPL]: "AAPL",
  [METRICS.MSFT]: "MSFT",
  [METRICS.GOOGL]: "GOOGL",
  [METRICS.AMZN]: "AMZN",
  [METRICS.NVDA]: "NVDA",
  [METRICS.META]: "META",
  [METRICS.TSLA]: "TSLA",
};

interface YahooChartResult {
  chart: {
    result: [
      {
        timestamp: number[];
        indicators: { quote: [{ close: (number | null)[] }] };
      },
    ] | null;
    error: { code: string; description: string } | null;
  };
}

async function fetchYahooSymbol(
  symbol: string,
  range: string
): Promise<{ date: string; value: number }[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo ${symbol} 요청 실패: ${res.status}`);
  const data = (await res.json()) as YahooChartResult;
  if (data.chart.error) throw new Error(`Yahoo ${symbol} 오류: ${data.chart.error.description}`);
  const result = data.chart.result?.[0];
  if (!result) throw new Error(`Yahoo ${symbol}: 데이터 없음`);

  const closes = result.indicators.quote[0].close;
  const out: { date: string; value: number }[] = [];
  result.timestamp.forEach((ts, i) => {
    const value = closes[i];
    if (value === null || value === undefined) return;
    out.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), value });
  });
  return out;
}

/** 매일 파이프라인용 — 최근 5거래일치(공휴일 등 결측 대비 여유분). */
export async function fetchYahooLatest(metric: string): Promise<FetchedPoint[]> {
  const symbol = YAHOO_TICKERS[metric];
  if (!symbol) throw new Error(`${metric}은 Yahoo 대상이 아니다`);
  const points = await fetchYahooSymbol(symbol, "5d");
  return points.map((p) => ({ ...p, metric, source: "yahoo" as const }));
}

/** 백필용 — 1년치. */
export async function fetchYahooHistorical(metric: string): Promise<FetchedPoint[]> {
  const symbol = YAHOO_TICKERS[metric];
  if (!symbol) throw new Error(`${metric}은 Yahoo 대상이 아니다`);
  const points = await fetchYahooSymbol(symbol, "1y");
  return points.map((p) => ({ ...p, metric, source: "yahoo" as const }));
}

export async function fetchAllYahooLatest(): Promise<{
  points: FetchedPoint[];
  errors: { metric: string; message: string }[];
}> {
  const points: FetchedPoint[] = [];
  const errors: { metric: string; message: string }[] = [];
  for (const metric of Object.keys(YAHOO_TICKERS)) {
    try {
      points.push(...(await fetchYahooLatest(metric)));
    } catch (err) {
      errors.push({ metric, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { points, errors };
}

// ── 6단계 섹터 ETF (finviz 대체 — 직접 계산용 원자료) ──────────
export interface SectorRawData {
  name: string; // "한글라벨(티커)" 형태 — 티커만으로는 무슨 섹터인지 알기 어려워 라벨을 붙인다
  ticker: string;
  return5d: number;
  changePct1d: number; // 전일 대비 등락률(%)
  volumeRatio: number; // 최근 거래량 ÷ 20일 평균 거래량
}

interface YahooChartWithVolume {
  chart: {
    result: [
      {
        timestamp: number[];
        indicators: { quote: [{ close: (number | null)[]; volume: (number | null)[] }] };
      },
    ] | null;
    error: { code: string; description: string } | null;
  };
}

async function fetchSectorRaw(sectorKey: keyof typeof SECTOR_ETFS): Promise<SectorRawData> {
  const ticker = SECTOR_ETFS[sectorKey];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1mo&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo ${ticker} 요청 실패: ${res.status}`);
  const data = (await res.json()) as YahooChartWithVolume;
  const result = data.chart.result?.[0];
  if (!result) throw new Error(`Yahoo ${ticker}: 데이터 없음`);

  const closes = result.indicators.quote[0].close.filter((v): v is number => v !== null);
  const volumes = result.indicators.quote[0].volume.filter((v): v is number => v !== null);

  const last = closes.length;
  const close5dAgo = closes[Math.max(0, last - 6)];
  const closeLatest = closes[last - 1];
  const closePrevDay = closes[Math.max(0, last - 2)];
  const return5d = ((closeLatest - close5dAgo) / close5dAgo) * 100;
  const changePct1d = ((closeLatest - closePrevDay) / closePrevDay) * 100;

  // 주의: 장중에 호출하면 당일 거래량이 아직 다 안 찍혀서 volumeRatio가 낮게 나온다.
  // 매일 09시(KST) 파이프라인은 미국 장 마감 후라 이 문제가 없다 — 디버그용으로 장중에 호출할 때만 주의.
  const recentVolume = volumes[volumes.length - 1];
  const avgVolume20d =
    volumes.slice(-20).reduce((sum, v) => sum + v, 0) / Math.min(20, volumes.length);
  const volumeRatio = recentVolume / avgVolume20d;

  return { name: `${SECTOR_LABELS[sectorKey]}(${ticker})`, ticker, return5d, changePct1d, volumeRatio };
}

/** 6단계 섹터 10개 원자료를 한 번에 가져온다. */
export async function fetchAllSectors(): Promise<SectorRawData[]> {
  const keys = Object.keys(SECTOR_ETFS) as (keyof typeof SECTOR_ETFS)[];
  const results = await Promise.allSettled(keys.map(fetchSectorRaw));
  return results
    .filter((r): r is PromiseFulfilledResult<SectorRawData> => r.status === "fulfilled")
    .map((r) => r.value);
}
