// 한국투자증권 Open API(apiportal.koreainvestment.com) — 외국인 코스피 순매수 대금.
// 무료 KRX 데이터포털(data.krx.co.kr) 비공식 엔드포인트를 먼저 시도했으나 세션 쿠키·Referer를
// 그대로 흉내내도 매번 "LOGOUT"만 돌아와(CNN 공포탐욕지수보다 훨씬 강한 봇 차단) 포기했다 — 이
// API는 실전투자 계좌에 연결된 정식 키가 필요하지만 대신 안정적으로 동작한다.
//
// tr_id FHPTJ04040000(시장별 투자자매매동향·일별)은 FID_INPUT_DATE_1/2를 실제 범위 필터로 안 쓰고,
// DATE_1을 "기준일"로만 써서 그 날짜(비영업일이면 직전 영업일로 자동 보정) 기준 과거 최대 300
// 거래일치를 최신순으로 통째로 돌려준다 — 그래서 DATE_2는 DATE_1과 동일하게 채우고, 필요한
// 최근 며칠만 잘라 쓴다. 응답값(frgn_ntby_tr_pbmn)은 백만원 단위로 확인됨(실측: 하루 약
// 72억~7,240억원 규모로 코스피 전체 외국인 순매수 대금과 일치).
import { METRICS, type FetchedPoint } from "./types";

const BASE_URL = "https://openapi.koreainvestment.com:9443";

interface KisTokenResponse {
  access_token?: string;
  msg1?: string;
}

async function getAccessToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
  });
  const data = (await res.json()) as KisTokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(`KIS 토큰 발급 실패: ${res.status} ${data.msg1 ?? JSON.stringify(data)}`);
  }
  return data.access_token;
}

function fmtDateParam(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

interface KisInvestorDailyRow {
  stck_bsop_date: string; // YYYYMMDD
  frgn_ntby_tr_pbmn: string; // 외국인 순매수 거래대금(백만원)
}

interface KisInvestorDailyResponse {
  rt_cd: string;
  msg1: string;
  output?: KisInvestorDailyRow[];
}

/** 최근 거래일 기준 최근 며칠치 코스피 외국인 순매수 대금(백만원)을 가져온다. */
export async function fetchForeignNetBuyKospi(days = 10): Promise<{ points: FetchedPoint[]; errors: string[] }> {
  if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) {
    return { points: [], errors: [] };
  }

  try {
    const token = await getAccessToken();
    const today = fmtDateParam(new Date());
    const params = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: "U",
      FID_INPUT_ISCD: "0001",
      FID_INPUT_DATE_1: today,
      FID_INPUT_ISCD_1: "KSP",
      FID_INPUT_DATE_2: today,
      FID_INPUT_ISCD_2: "0001",
    });

    const res = await fetch(
      `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market?${params.toString()}`,
      {
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${token}`,
          appkey: process.env.KIS_APP_KEY,
          appsecret: process.env.KIS_APP_SECRET,
          tr_id: "FHPTJ04040000",
          custtype: "P",
        },
      }
    );
    const data = (await res.json()) as KisInvestorDailyResponse;
    if (!res.ok || data.rt_cd !== "0") {
      throw new Error(`KIS 외국인 순매수 조회 실패: ${res.status} ${data.msg1 ?? ""}`);
    }

    const points: FetchedPoint[] = (data.output ?? []).slice(0, days).map((row) => ({
      metric: METRICS.FOREIGN_NET_BUY_KOSPI,
      date: `${row.stck_bsop_date.slice(0, 4)}-${row.stck_bsop_date.slice(4, 6)}-${row.stck_bsop_date.slice(6, 8)}`,
      value: Number(row.frgn_ntby_tr_pbmn),
      source: "kis",
    }));
    return { points, errors: [] };
  } catch (err) {
    return { points: [], errors: [err instanceof Error ? err.message : String(err)] };
  }
}
