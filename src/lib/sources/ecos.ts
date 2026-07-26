import { METRICS, type FetchedPoint } from "./types";

// 한국은행 ECOS OpenAPI. 무료, 가입만 하면 즉시 발급(하루 약 1000회 호출 제한).
// 발급: https://ecos.bok.or.kr/api/
// StatisticItemList API로 실제 항목코드 조회해서 확정함(2026-07-25).
const STAT_CODE_MARKET_RATE = "817Y002";
const CODE_KR10Y = "010210000"; // 국고채(10년) — 확인됨

interface EcosRow {
  TIME: string; // 일별: YYYYMMDD, 월별: YYYYMM
  DATA_VALUE: string;
}

interface EcosResponse {
  StatisticSearch?: {
    row?: EcosRow[];
  };
  RESULT?: { CODE: string; MESSAGE: string };
}

function isoDateFromYyyymmdd(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchEcosSeries(
  apiKey: string,
  statCode: string,
  itemCode: string,
  cycle: "D" | "M",
  startPeriod: string,
  endPeriod: string
): Promise<EcosRow[]> {
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${apiKey}/json/en/1/1000/${statCode}/${cycle}/${startPeriod}/${endPeriod}/${itemCode}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ECOS 요청 실패: ${res.status}`);
  const data = (await res.json()) as EcosResponse;
  if (data.RESULT && data.RESULT.CODE !== "INFO-000") {
    throw new Error(`ECOS 오류: ${data.RESULT.CODE} ${data.RESULT.MESSAGE}`);
  }
  return data.StatisticSearch?.row ?? [];
}

/** 한국 10년 국고채 금리. 일별. */
export async function fetchKr10y(
  apiKey: string,
  fromDate: Date,
  toDate: Date = new Date()
): Promise<FetchedPoint[]> {
  const rows = await fetchEcosSeries(
    apiKey,
    STAT_CODE_MARKET_RATE,
    CODE_KR10Y,
    "D",
    toYmd(fromDate),
    toYmd(toDate)
  );
  return rows.map((r) => ({
    metric: METRICS.KR10Y,
    date: isoDateFromYyyymmdd(r.TIME),
    value: parseFloat(r.DATA_VALUE),
    source: "ecos" as const,
  }));
}
