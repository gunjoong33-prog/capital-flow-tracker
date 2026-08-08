import { METRICS, SECTOR_ETFS, SECTOR_LABELS, type FetchedPoint } from "./types";

// Yahoo가 유일한 소스인 지표가 20여개라 Yahoo가 막히면 4·5·6단계가 동시에 전멸한다(외부 감사
// 지적, 실제 확인). Stooq를 폴백으로 검토했으나 실제로 호출해보니 CSV 다운로드가 JS 작업증명
// 챌린지로 막혀 있어(서버사이드 fetch로 못 뚫음) 탈락했다. Alpha Vantage(무료 키, 25회/일,
// 5회/분)를 채점에 실제로 쓰이는 지표로만 좁혀서 대신 쓴다 — 전체를 커버하기엔 하루 한도가
// 부족하고, 폴백은 Yahoo가 실패한 날에만 호출되므로 평소엔 한도를 안 쓴다.
//
// 검증 없이 프록시를 넣지 않는다(WTI/브렌트 괴리 감지 사례와 같은 원칙) — 실제로 호출해서
// 대조해본 결과:
// - SPY→SPX, DIA→DJI, IWM→RUT: 당일 등락률이 0.05%p 이내로 거의 일치(안전)
// - QQQ→NDX: 0.05%p 안팎 오차(허용 범위, 널리 쓰이는 추적 ETF)
// - GLD→GOLD: 같은 날 -1.49% vs -0.04%로 크게 어긋남(불채택)
// - UUP→DXY: 같은 날 방향 자체가 반대로 나옴(+0.11% vs -0.21%, 불채택 — 4단계 사분면 판정을
//   반대로 뒤집을 수 있어 위험)
// - VIXY→VIX: 절대 수준 자체가 옵션 롤오버로 구조적으로 감가(현재 우연히 비슷한 숫자대일
//   뿐 장기적으로 무관) — VIX는 절대 임계값(15/25)으로 채점해서 프록시 자체가 성립 안 함
//
// 섹터 ETF(XLK 등)는 Yahoo·우리 6단계가 원래 쓰는 티커 그 자체라 프록시 위험이 없다.
const AV_INDEX_PROXY: Partial<Record<string, string>> = {
  [METRICS.SPX]: "SPY",
  [METRICS.DJI]: "DIA",
  [METRICS.NDX]: "QQQ",
  [METRICS.RUT]: "IWM",
};

interface GlobalQuoteResponse {
  "Global Quote"?: {
    "05. price"?: string;
    "10. change percent"?: string;
  };
  Information?: string;
  Note?: string;
}

async function fetchGlobalQuote(symbol: string, apiKey: string): Promise<{ price: number; changePct: number }> {
  const res = await fetch(
    `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`
  );
  if (!res.ok) throw new Error(`Alpha Vantage ${symbol} 요청 실패: ${res.status}`);
  const data = (await res.json()) as GlobalQuoteResponse;
  if (data.Information || data.Note) throw new Error(`Alpha Vantage ${symbol}: ${data.Information ?? data.Note}`);
  const quote = data["Global Quote"];
  const price = quote?.["05. price"] ? parseFloat(quote["05. price"]) : NaN;
  const changePct = quote?.["10. change percent"] ? parseFloat(quote["10. change percent"].replace("%", "")) : NaN;
  if (Number.isNaN(price) || Number.isNaN(changePct)) throw new Error(`Alpha Vantage ${symbol}: 응답 파싱 실패`);
  return { price, changePct };
}

/**
 * 지수 폴백 — ETF 가격을 그대로 저장하면 안 된다(SPY~$747 vs SPX~7489, 스케일이 완전히 다름).
 * 대신 검증된 ETF의 당일 등락률을 우리 DB에 남아있는 마지막 실제 지수값에 곱해서 근사치를
 * 합성한다 — 스케일은 항상 실제 지수 기준으로 유지되고, 등락률만 프록시에서 빌려온다.
 */
export async function fetchIndexFallback(
  metric: string,
  lastRealValue: number,
  apiKey: string
): Promise<FetchedPoint> {
  const symbol = AV_INDEX_PROXY[metric];
  if (!symbol) throw new Error(`${metric}은 Alpha Vantage 지수 폴백 대상이 아니다`);
  const { changePct } = await fetchGlobalQuote(symbol, apiKey);
  const syntheticValue = lastRealValue * (1 + changePct / 100);
  const today = new Date().toISOString().slice(0, 10);
  return { metric, date: today, value: syntheticValue, source: "alphavantage" };
}

interface DailySeriesResponse {
  "Time Series (Daily)"?: Record<string, { "4. close": string; "5. volume": string }>;
  Information?: string;
  Note?: string;
}

/** 섹터 ETF 폴백 — 같은 티커를 그대로 쓰므로 프록시 스케일 문제가 없다. Yahoo의 fetchSectorRaw와
 * 같은 방식(5일 수익률, 20일 평균 대비 거래량 배율)으로 직접 계산한다. */
export async function fetchSectorFallback(
  sectorKey: keyof typeof SECTOR_ETFS,
  apiKey: string
): Promise<{ name: string; ticker: string; return5d: number; changePct1d: number; volumeRatio: number }> {
  const ticker = SECTOR_ETFS[sectorKey];
  const res = await fetch(
    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`
  );
  if (!res.ok) throw new Error(`Alpha Vantage ${ticker} 요청 실패: ${res.status}`);
  const data = (await res.json()) as DailySeriesResponse;
  if (data.Information || data.Note) throw new Error(`Alpha Vantage ${ticker}: ${data.Information ?? data.Note}`);
  const series = data["Time Series (Daily)"];
  if (!series) throw new Error(`Alpha Vantage ${ticker}: 데이터 없음`);

  // 날짜 내림차순(최신이 먼저)으로 오므로 오름차순으로 뒤집어 Yahoo 쪽 계산 로직과 순서를 맞춘다.
  const dates = Object.keys(series).sort();
  const closes = dates.map((d) => parseFloat(series[d]["4. close"]));
  const volumes = dates.map((d) => parseFloat(series[d]["5. volume"]));

  const last = closes.length;
  const close5dAgo = closes[Math.max(0, last - 6)];
  const closeLatest = closes[last - 1];
  const closePrevDay = closes[Math.max(0, last - 2)];
  const return5d = ((closeLatest - close5dAgo) / close5dAgo) * 100;
  const changePct1d = ((closeLatest - closePrevDay) / closePrevDay) * 100;

  const recentVolume = volumes[volumes.length - 1];
  const priorVolumes = volumes.slice(0, -1).slice(-20);
  const avgVolume20d = priorVolumes.reduce((sum, v) => sum + v, 0) / priorVolumes.length;
  const volumeRatio = recentVolume / avgVolume20d;

  return { name: `${SECTOR_LABELS[sectorKey]}(${ticker})`, ticker, return5d, changePct1d, volumeRatio };
}

/** 무료 티어 5회/분 한도 — 폴백은 Yahoo가 이미 실패한 날에만 호출되는 드문 경로라
 * 호출 사이 대기로 여유 있게 페이스를 맞춘다(과속으로 429 받아 전체 폴백이 실패하는 것보다 낫다). */
export function alphaVantagePace(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 13_000));
}

interface PutCallRatioResponse {
  symbol?: string;
  put_call_ratio_full_chain?: string;
  Information?: string;
  Note?: string;
}

/** SPY 전체 옵션 체인 put/call 거래량 비율 — 무료 티어에 포함된 REALTIME_PUT_CALL_RATIO 사용.
 * HISTORICAL_OPTIONS(과거 체인 원자료)는 프리미엄 전용이라 못 쓰지만, 이 비율 자체는 무료다
 * (실제 호출해서 확인함, 2026-08-09). 1.0 위/아래 절대 임계값은 아직 검증 안 됐으므로 8단계
 * 채점에는 안 쓰고 7단계 심리필터에 참고 정보로만 노출한다. */
export async function fetchPutCallRatio(apiKey: string, symbol = "SPY"): Promise<number> {
  const res = await fetch(
    `https://www.alphavantage.co/query?function=REALTIME_PUT_CALL_RATIO&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`
  );
  if (!res.ok) throw new Error(`Alpha Vantage Put/Call ${symbol} 요청 실패: ${res.status}`);
  const data = (await res.json()) as PutCallRatioResponse;
  if (data.Information || data.Note) throw new Error(`Alpha Vantage Put/Call ${symbol}: ${data.Information ?? data.Note}`);
  const ratio = data.put_call_ratio_full_chain ? parseFloat(data.put_call_ratio_full_chain) : NaN;
  if (Number.isNaN(ratio)) throw new Error(`Alpha Vantage Put/Call ${symbol}: 응답 파싱 실패`);
  return ratio;
}
