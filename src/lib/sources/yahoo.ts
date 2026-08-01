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
  [METRICS.DXY]: "DX-Y.NYB",
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
    const date = new Date(ts * 1000);
    // 통화쌍(USD/JPY 등)은 실제 거래가 없는 토·일요일에도 야후가 금요일 종가를 그대로 복제한
    // 봉을 얹어 돌려줄 때가 있다 — 이걸 그대로 저장하면 "전일 대비 0.00%"로 찍혀 실제로는
    // 이미 금요일 값에 반영된 변동을 "안정"으로 오판하게 만든다(엔화 변동성 급등 감지 무력화).
    // 주식·지수는 애초에 주말 봉이 안 오므로 이 필터가 평일 데이터에 영향을 주지 않는다.
    const day = date.getUTCDay();
    if (day === 0 || day === 6) return;
    out.push({ date: date.toISOString().slice(0, 10), value });
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
        meta: { currentTradingPeriod: { regular: { start: number; end: number } } };
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
  let volumes = result.indicators.quote[0].volume.filter((v): v is number => v !== null);

  const last = closes.length;
  const close5dAgo = closes[Math.max(0, last - 6)];
  const closeLatest = closes[last - 1];
  const closePrevDay = closes[Math.max(0, last - 2)];
  const return5d = ((closeLatest - close5dAgo) / close5dAgo) * 100;
  const changePct1d = ((closeLatest - closePrevDay) / closePrevDay) * 100;

  // /report 페이지는 방문할 때마다 이 함수를 실시간 호출한다(09시 파이프라인 전용이 아니다) — 그래서
  // 미국 장중(KST 22:30~05:00경)에 방문하면 마지막 봉이 아직 장이 안 끝난 "당일 진행 중" 봉이라
  // 거래량이 다 안 찍힌 채로 20일 평균과 비교돼 volumeRatio가 구조적으로 낮게 나온다. "지금이
  // 마감 전인가"만 보면 장 시작 전(프리마켓)에도 참으로 나와 이미 완결된 어제 봉까지 잘못 잘라내니,
  // 마지막 봉의 타임스탬프가 실제로 "오늘 정규장 시작 이후"인지도 함께 확인해야 한다 — 오늘 봉이
  // 아직 없으면(장 시작 전) 그대로 두고, 오늘 봉이 이미 있는데 마감 전이면(장중) 그 봉만 제외한다.
  const { start: sessionStart, end: sessionEnd } = result.meta.currentTradingPeriod.regular;
  const lastTimestampMs = result.timestamp[result.timestamp.length - 1] * 1000;
  const lastCandleIsTodayInProgress = lastTimestampMs >= sessionStart * 1000 && Date.now() < sessionEnd * 1000;
  if (lastCandleIsTodayInProgress) volumes = volumes.slice(0, -1);

  // 주의: 장중에 호출하면 당일 거래량이 아직 다 안 찍혀서 volumeRatio가 낮게 나온다.
  // 매일 09시(KST) 파이프라인은 미국 장 마감 후라 이 문제가 없다 — 디버그용으로 장중에 호출할 때만 주의.
  //
  // 당일(recentVolume) 자신을 20일 평균의 분모에 포함시키면 안 된다 — "오늘 거래량이 최근 평균보다
  // 몇 배인가"를 재는 지표인데 오늘 값이 자기 자신을 재는 기준에 섞여 들어가면 배수가 구조적으로
  // 항상 낮게(자기 자신 쪽으로 쏠리며) 나온다. 당일 이전 20봉만으로 평균을 낸다.
  const recentVolume = volumes[volumes.length - 1];
  const priorVolumes = volumes.slice(0, -1).slice(-20);
  const avgVolume20d = priorVolumes.reduce((sum, v) => sum + v, 0) / priorVolumes.length;
  const volumeRatio = recentVolume / avgVolume20d;

  return { name: `${SECTOR_LABELS[sectorKey]}(${ticker})`, ticker, return5d, changePct1d, volumeRatio };
}

/**
 * 6단계 섹터 10개 원자료를 한 번에 가져온다.
 * 일부만 실패해도(예: Yahoo가 특정 티커만 막음) 성공한 것만 조용히 돌려주면 몇 개가 빠졌는지
 * 알 길이 없다 — 3·4·5·7단계처럼 실패한 섹터는 이름을 남겨서 "확인 못함"으로 명시할 수 있게 한다.
 * 섹터 데이터는 시계열로 저장하지 않고 매번 라이브로만 조회하므로(볼륨까지 필요해 MetricValue
 * 스키마와 안 맞음), "N일 전 데이터" 폴백은 구조적으로 불가능하고 확인 못함 처리만 가능하다.
 */
export async function fetchAllSectors(): Promise<{ sectors: SectorRawData[]; errors: { sector: string; message: string }[] }> {
  const keys = Object.keys(SECTOR_ETFS) as (keyof typeof SECTOR_ETFS)[];
  const results = await Promise.allSettled(keys.map(fetchSectorRaw));
  const sectors: SectorRawData[] = [];
  const errors: { sector: string; message: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") sectors.push(r.value);
    else errors.push({ sector: `${SECTOR_LABELS[keys[i]]}(${SECTOR_ETFS[keys[i]]})`, message: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  });
  return { sectors, errors };
}
