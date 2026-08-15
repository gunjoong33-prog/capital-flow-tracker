// 뉴스 헤드라인과 연관된 종목의 "속보 이후 시장 반응"을 계산한다. yahoo.ts의
// fetchYahooAtUsClose와 같은 Yahoo 비공식 장중봉 엔드포인트를 재사용하지만 목적이 다르다 —
// 정산가 확정이 아니라 "기사 발행 시각 근처 가격 대비 최신 가격"의 스냅샷 비교.
//
// 안전 원칙(이 파일 전체에 적용):
// 1) 실패해도 절대 숫자를 지어내지 않는다 — changePct: null로 돌려주고 화면은 "확인 못함"으로 표시.
// 2) 한 종목 조회 실패가 다른 종목·페이지 전체에 번지지 않는다 — 호출부가 Promise.allSettled로 격리.
// 3) 응답이 안 오는 요청이 무한정 남지 않는다 — AbortController로 타임아웃.
// 4) 너무 오래된 뉴스는 계산 자체를 생략한다 — Yahoo 무료 1분봉 보관기간이 짧고, 오래될수록
//    "속보 반응"이라는 의미 자체가 흐려진다.
const FETCH_TIMEOUT_MS = 8000;
const MAX_LOOKBACK_DAYS = 5;
// 1분봉 실측 확인(2026-08-15): AAPL·^KS11 8일치까지 결측 없이 정상 응답 — 5일 룩백보다 여유
// 있게 남아 5분봉 대신 안전하게 쓸 수 있다. 정밀도가 최대 5배(5분→1분) 개선된다.

export interface NewsReaction {
  ticker: string;
  changePct: number | null;
  asOfLabel: string | null;
}

export interface IntradayBar {
  timestamp: number; // unix seconds
  close: number;
}

interface YahooChartResult {
  chart: {
    result: [{ timestamp: number[]; indicators: { quote: [{ close: (number | null)[] }] } }] | null;
    error: { code: string; description: string } | null;
  };
}

async function fetchIntradayBars(yahooSymbol: string): Promise<IntradayBar[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5d&interval=1m`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: controller.signal });
    if (!res.ok) throw new Error(`Yahoo ${yahooSymbol} 요청 실패: ${res.status}`);
    const data = (await res.json()) as YahooChartResult;
    if (data.chart.error) throw new Error(`Yahoo ${yahooSymbol} 오류: ${data.chart.error.description}`);
    const result = data.chart.result?.[0];
    if (!result) throw new Error(`Yahoo ${yahooSymbol}: 데이터 없음`);

    const closes = result.indicators.quote[0].close;
    const bars: IntradayBar[] = [];
    result.timestamp.forEach((ts, i) => {
      const close = closes[i];
      if (close !== null && close !== undefined) bars.push({ timestamp: ts, close });
    });
    return bars;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 발행 시각 이후 첫 봉("속보가 반영되기 시작한 시점")과 가장 최근 봉("지금까지의 반응")을 고른다.
 * 순수 함수로 분리해 네트워크 없이 테스트한다 — 실제 버그(예: 발행 시각이 데이터 범위 밖인 경계
 * 케이스)가 이 로직에서 나기 쉽다.
 */
export function pickReactionBars(
  bars: IntradayBar[],
  publishedAtUnix: number
): { snap: IntradayBar; latest: IntradayBar } | null {
  if (bars.length < 2) return null;
  const latest = bars[bars.length - 1];
  // 발행 시각 이후 첫 봉을 찾는다 — 못 찾으면(막 발행돼 아직 그 시각 봉이 안 찍힌 경우) 가장 최근
  // 봉으로 대체한다(이 경우 snap과 latest가 같아 changePct는 0이 아니라 스냅 실패로 취급해야
  // 하므로, 호출부가 snap===latest를 별도로 걸러낸다).
  const snap = bars.find((b) => b.timestamp >= publishedAtUnix) ?? latest;
  return { snap, latest };
}

function formatAsOfLabel(unixSeconds: number): string {
  const formatted = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
  return `${formatted} KST 기준`;
}

export async function computeNewsReaction(
  ticker: string,
  yahooSymbol: string,
  publishedAt: Date
): Promise<NewsReaction> {
  const fallback: NewsReaction = { ticker, changePct: null, asOfLabel: null };

  const ageDays = (Date.now() - publishedAt.getTime()) / 86_400_000;
  if (ageDays > MAX_LOOKBACK_DAYS || ageDays < 0) return fallback;

  try {
    const bars = await fetchIntradayBars(yahooSymbol);
    const picked = pickReactionBars(bars, Math.floor(publishedAt.getTime() / 1000));
    if (!picked || picked.snap === picked.latest || picked.snap.close === 0) return fallback;

    const changePct = ((picked.latest.close - picked.snap.close) / picked.snap.close) * 100;
    return { ticker, changePct, asOfLabel: formatAsOfLabel(picked.snap.timestamp) };
  } catch {
    return fallback;
  }
}
