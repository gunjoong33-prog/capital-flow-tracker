import { METRICS, type FetchedPoint } from "./types";

// 일본 재무성(MOF) 공식 국채금리 CSV. 무료, 키 불필요, 매일 갱신.
// https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/index.htm
const CURRENT_CSV = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv";
const HISTORICAL_CSV =
  "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/historical/jgbcme_all.csv";

// 헤더: Date,1Y,2Y,3Y,4Y,5Y,6Y,7Y,8Y,9Y,10Y,15Y,20Y,25Y,30Y,40Y
// "10Y"는 Date를 포함해 10번째 인덱스(0-based).
const TEN_YEAR_INDEX = 10;

function parseCsv(csvText: string): FetchedPoint[] {
  const lines = csvText.split("\n").filter((l) => l.trim().length > 0);
  const points: FetchedPoint[] = [];

  for (const line of lines) {
    const cols = line.split(",");
    // 날짜 형식: 2026/7/23
    const dateMatch = cols[0]?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!dateMatch) continue; // 헤더·안내문 줄 스킵

    const [, y, m, d] = dateMatch;
    const value = parseFloat(cols[TEN_YEAR_INDEX]);
    if (Number.isNaN(value)) continue;

    const date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    points.push({ metric: METRICS.JP10Y, date, value, source: "mof" });
  }

  return points;
}

/** 최신 값들(당월치)만. 매일 파이프라인용. */
export async function fetchJp10yLatest(): Promise<FetchedPoint[]> {
  const res = await fetch(CURRENT_CSV);
  if (!res.ok) throw new Error(`MOF JGB CSV 요청 실패: ${res.status}`);
  const text = await res.text();
  return parseCsv(text);
}

/** 1974년부터 전체 — 백필용(1년치만 잘라 쓰면 됨). */
export async function fetchJp10yHistorical(): Promise<FetchedPoint[]> {
  const res = await fetch(HISTORICAL_CSV);
  if (!res.ok) throw new Error(`MOF JGB 히스토리 CSV 요청 실패: ${res.status}`);
  const text = await res.text();
  return parseCsv(text);
}
