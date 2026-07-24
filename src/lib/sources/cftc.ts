import { METRICS, type FetchedPoint } from "./types";

// CFTC 공개 데이터 포털(Socrata). 인증 없이 조회 가능(공개 데이터셋).
// "Traders in Financial Futures"(TFF) 데이터셋 — 통화 선물엔 이쪽이 Legacy보다 적합.
const CFTC_TFF_DATASET = "gpe5-46if";

interface CftcRow {
  report_date_as_yyyy_mm_dd: string;
  lev_money_positions_long: string;
  lev_money_positions_short: string;
}

/**
 * CFTC 엔화 선물 순포지션(레버리지드펀드 기준 = "투기 세력").
 * 매주 금요일 발표, 최대 6일 지연.
 * @param startDate 백필용 (YYYY-MM-DD)
 */
export async function fetchCftcJpyNetPosition(
  startDate?: string
): Promise<FetchedPoint[]> {
  const whereClauses = ["contract_market_name = 'JAPANESE YEN'"];
  if (startDate) {
    whereClauses.push(`report_date_as_yyyy_mm_dd >= '${startDate}T00:00:00.000'`);
  }

  const params = new URLSearchParams({
    $where: whereClauses.join(" AND "),
    $order: "report_date_as_yyyy_mm_dd ASC",
    $limit: "500",
  });

  const res = await fetch(
    `https://publicreporting.cftc.gov/resource/${CFTC_TFF_DATASET}.json?${params}`
  );
  if (!res.ok) {
    throw new Error(`CFTC 요청 실패: ${res.status} ${res.statusText}`);
  }
  const rows = (await res.json()) as CftcRow[];

  return rows.map((row) => {
    const net =
      parseFloat(row.lev_money_positions_long) -
      parseFloat(row.lev_money_positions_short);
    return {
      metric: METRICS.CFTC_JPY_NET,
      date: row.report_date_as_yyyy_mm_dd.slice(0, 10),
      value: net,
      source: "cftc" as const,
    };
  });
}

/** 매일 파이프라인용 — 가장 최근 발표분 1건만. */
export async function fetchCftcJpyNetPositionLatest(): Promise<FetchedPoint | null> {
  const params = new URLSearchParams({
    $where: "contract_market_name = 'JAPANESE YEN'",
    $order: "report_date_as_yyyy_mm_dd DESC",
    $limit: "1",
  });
  const res = await fetch(
    `https://publicreporting.cftc.gov/resource/${CFTC_TFF_DATASET}.json?${params}`
  );
  if (!res.ok) {
    throw new Error(`CFTC 요청 실패: ${res.status} ${res.statusText}`);
  }
  const rows = (await res.json()) as CftcRow[];
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    metric: METRICS.CFTC_JPY_NET,
    date: row.report_date_as_yyyy_mm_dd.slice(0, 10),
    value:
      parseFloat(row.lev_money_positions_long) -
      parseFloat(row.lev_money_positions_short),
    source: "cftc" as const,
  };
}
