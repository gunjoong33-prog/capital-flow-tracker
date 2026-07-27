// CNN 공포와 탐욕 지수(Fear & Greed Index) — 공식 API는 없지만, cnn.com/markets/fear-and-greed
// 페이지 자체가 그래프를 그릴 때 호출하는 데이터 엔드포인트가 있다. Referer 없이 요청하면
// 418(bot 차단)이 오지만, 실제 브라우저가 그 페이지에서 보내는 것과 같은 Referer/Origin
// 헤더를 주면 그 공개 페이지가 보여주는 것과 완전히 동일한 데이터(오늘 값 + 1년치 히스토리)를
// 그대로 돌려준다 — 로그인/구독 뒤에 숨겨진 걸 우회하는 게 아니라 공개 데이터를 더 효율적으로
// 가져오는 것뿐이다(Yahoo Finance 비공식 API와 같은 원칙 — 예고 없이 바뀌거나 막힐 수 있음).
import { METRICS, type FetchedPoint } from "./types";

const ENDPOINT = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Referer: "https://www.cnn.com/markets/fear-and-greed",
  Origin: "https://www.cnn.com",
  Accept: "application/json, text/plain, */*",
};

interface CnnFearGreedResponse {
  fear_and_greed: { score: number; timestamp: string };
  fear_and_greed_historical: { data: { x: number; y: number }[] };
}

async function fetchRaw(): Promise<CnnFearGreedResponse> {
  const res = await fetch(ENDPOINT, { headers: HEADERS });
  if (!res.ok) throw new Error(`CNN 공포탐욕지수 조회 실패: ${res.status}`);
  return (await res.json()) as CnnFearGreedResponse;
}

/** 매일 파이프라인용 — 오늘 값 하나만. */
export async function fetchCnnFearGreedLatest(): Promise<FetchedPoint[]> {
  const data = await fetchRaw();
  return [{
    metric: METRICS.CNN_FEAR_GREED,
    date: data.fear_and_greed.timestamp.slice(0, 10),
    value: data.fear_and_greed.score,
    source: "cnn" as const,
  }];
}

/** 백필용 — 응답에 포함된 히스토리 전체(약 1년치). */
export async function fetchCnnFearGreedHistorical(): Promise<FetchedPoint[]> {
  const data = await fetchRaw();
  return data.fear_and_greed_historical.data.map((p) => ({
    metric: METRICS.CNN_FEAR_GREED,
    date: new Date(p.x).toISOString().slice(0, 10),
    value: p.y,
    source: "cnn" as const,
  }));
}
