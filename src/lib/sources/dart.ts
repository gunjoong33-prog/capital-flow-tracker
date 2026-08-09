// DART(금융감독원 전자공시, opendart.fss.or.kr) 지분공시 — 미국 OpenInsider의 국내판.
// list.json으로 오늘자 지분공시(pblntf_ty=D) 목록을 받고, 그중 최근 것 상위 N건만 상세
// (majorstock/elestock)를 조회해 변동폭을 얻는다 — 하루 100건 넘게 올라오는 날도 있어서
// 전부 상세조회하면 파이프라인이 느려진다(institutional-signals.ts의 "매니저당 1건" 같은
// 절제 원칙과 동일 — 전부 보여주면 정보량이 0이 된다).
import { toYYYYMMDDCompact } from "@/lib/date";

const LIST_URL = "https://opendart.fss.or.kr/api/list.json";
const MAJORSTOCK_URL = "https://opendart.fss.or.kr/api/majorstock.json";
const ELESTOCK_URL = "https://opendart.fss.or.kr/api/elestock.json";

interface DartListItem {
  corp_code: string;
  corp_name: string;
  report_nm: string;
  rcept_no: string;
  flr_nm: string;
  rcept_dt: string;
}

interface DartListResponse {
  status: string;
  message: string;
  list?: DartListItem[];
}

interface MajorstockRow {
  rcept_no: string;
  stkrt: string;
  stkrt_irds: string;
}

interface ElestockRow {
  rcept_no: string;
  sp_stock_lmp_rate: string;
  sp_stock_lmp_irds_rate: string;
}

export interface DartFiling {
  type: "major" | "insider"; // 대량보유상황보고 vs 임원·주요주주소유보고
  corpName: string;
  filerName: string;
  stakePct: number | null; // 보고 시점 지분율(%)
  stakePctChange: number | null; // 직전 대비 변동폭(%p)
  rceptDt: string; // YYYYMMDD
}

async function fetchDetail(apiKey: string, item: DartListItem): Promise<DartFiling | null> {
  const isMajor = item.report_nm.includes("대량보유");
  const url = isMajor ? MAJORSTOCK_URL : ELESTOCK_URL;
  const res = await fetch(`${url}?crtfc_key=${apiKey}&corp_code=${item.corp_code}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { status: string; list?: (MajorstockRow | ElestockRow)[] };
  if (data.status !== "000" || !data.list) return null;
  const match = data.list.find((r) => r.rcept_no === item.rcept_no);
  if (!match) return null;

  const stakePct = isMajor ? parseFloat((match as MajorstockRow).stkrt) : parseFloat((match as ElestockRow).sp_stock_lmp_rate);
  const stakePctChange = isMajor
    ? parseFloat((match as MajorstockRow).stkrt_irds)
    : parseFloat((match as ElestockRow).sp_stock_lmp_irds_rate);

  return {
    type: isMajor ? "major" : "insider",
    corpName: item.corp_name,
    filerName: item.flr_nm,
    stakePct: Number.isFinite(stakePct) ? stakePct : null,
    stakePctChange: Number.isFinite(stakePctChange) ? stakePctChange : null,
    rceptDt: item.rcept_dt,
  };
}

/** 오늘자 지분공시(D=대량보유+임원소유) 목록을 받아 최근 것부터 최대 maxDetail건만 상세조회한다. */
export async function fetchEquityDisclosures(
  apiKey: string,
  date: Date = new Date(),
  maxDetail = 12
): Promise<{ filings: DartFiling[]; errors: string[] }> {
  const errors: string[] = [];
  const dateStr = toYYYYMMDDCompact(date);
  const res = await fetch(`${LIST_URL}?crtfc_key=${apiKey}&bgn_de=${dateStr}&end_de=${dateStr}&pblntf_ty=D&page_count=100`);
  if (!res.ok) {
    errors.push(`DART list.json 요청 실패: ${res.status}`);
    return { filings: [], errors };
  }
  const data = (await res.json()) as DartListResponse;
  if (data.status === "013") return { filings: [], errors }; // "조회된 데이터가 없습니다" — 정상(공시 없는 날)
  if (data.status !== "000" || !data.list) {
    errors.push(`DART list.json: ${data.status} ${data.message}`);
    return { filings: [], errors };
  }

  const targets = data.list.slice(0, maxDetail);
  const results = await Promise.all(targets.map((item) => fetchDetail(apiKey, item).catch(() => null)));
  const filings = results.filter((f): f is DartFiling => f !== null);
  return { filings, errors };
}
