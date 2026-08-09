// KRX 공매도 잔고비중(전종목, KOSPI) — 공식 Open API(openapi.krx.co.kr)엔 이 데이터가 없어서
// (전체 33개 서비스 확인 결과 시세·매매정보뿐) data.krx.co.kr의 비공식 내부 엔드포인트를 쓴다.
// 이 엔드포인트는 2026년 기준 실제 KRX 개인회원 로그인(JSESSIONID 세션)이 있어야 응답한다
// (로그인 없이 호출하면 "LOGOUT" 문자열만 옴 — 실제 확인함). ID/PW는 KRX_ID/KRX_PW 환경변수.
//
// 다른 소스(FRED·DART 등)처럼 발급받은 API 키가 아니라 실제 로그인 계정을 자동화에 쓰는
// 것이므로, data.krx.co.kr의 세션 발급 흐름(warmup 2회 GET → 로그인 POST → 중복로그인
// 시 skipDup 재시도)을 그대로 재현해야 쓸 수 있다. 사용자가 위험을 인지하고 승인함
// (openapi.krx.co.kr엔 공매도 데이터가 없다는 사실을 확인한 뒤 명시적으로 선택).
import { toYYYYMMDDCompact } from "@/lib/date";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const LOGIN_PAGE = "https://data.krx.co.kr/contents/MDC/COMS/client/MDCCOMS001.cmd";
const LOGIN_JSP = "https://data.krx.co.kr/contents/MDC/COMS/client/view/login.jsp?site=mdc";
const LOGIN_URL = "https://data.krx.co.kr/contents/MDC/COMS/client/MDCCOMS001D1.cmd";
const DATA_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const BLD_전종목_공매도_잔고 = "dbms/MDC/STAT/srt/MDCSTAT30501";

function collectSetCookies(res: Response): string[] {
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") return getSetCookie.call(res.headers);
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function mergeCookies(jar: Map<string, string>, setCookies: string[]): void {
  for (const raw of setCookies) {
    const pair = raw.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

interface LoginResponse {
  _error_code?: string;
  _error_message?: string;
}

/** pykrx의 login_krx()와 동일한 흐름(warmup 2회 → 로그인 → CD011 중복로그인 시 skipDup 재시도). */
async function loginKrx(id: string, pw: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();

  const warmup1 = await fetch(LOGIN_PAGE, { headers: { "User-Agent": USER_AGENT } });
  mergeCookies(jar, collectSetCookies(warmup1));
  const warmup2 = await fetch(LOGIN_JSP, { headers: { "User-Agent": USER_AGENT, Referer: LOGIN_PAGE, Cookie: cookieHeader(jar) } });
  mergeCookies(jar, collectSetCookies(warmup2));

  const doLogin = async (skipDup: boolean): Promise<LoginResponse> => {
    const body = new URLSearchParams({
      mbrNm: "",
      telNo: "",
      di: "",
      certType: "",
      mbrId: id,
      pw,
      ...(skipDup ? { skipDup: "Y" } : {}),
    });
    const res = await fetch(LOGIN_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Referer: LOGIN_PAGE,
        Cookie: cookieHeader(jar),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    mergeCookies(jar, collectSetCookies(res));
    return (await res.json()) as LoginResponse;
  };

  let result = await doLogin(false);
  if (result._error_code === "CD011") result = await doLogin(true);
  if (result._error_code === "CD010") throw new Error("KRX 비밀번호 변경 필요 — data.krx.co.kr에서 직접 변경 후 재시도");
  if (result._error_code !== "CD001") throw new Error(`KRX 로그인 실패: ${result._error_code} ${result._error_message ?? ""}`);

  return jar;
}

interface ShortBalanceRow {
  ISU_CD: string;
  ISU_ABBRV: string;
  BAL_QTY: string;
  LIST_SHRS: string;
  BAL_AMT: string;
  MKTCAP: string;
  BAL_RTO: string;
}

function parseKrxNumber(s: string): number {
  return parseFloat(s.replace(/,/g, ""));
}

async function fetchShortBalancePage(jar: Map<string, string>, trdDd: string, mktTpCd: number): Promise<ShortBalanceRow[]> {
  const body = new URLSearchParams({ bld: BLD_전종목_공매도_잔고, trdDd, mktTpCd: String(mktTpCd) });
  const res = await fetch(DATA_URL, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Referer: "https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookieHeader(jar),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (text.trim() === "LOGOUT") throw new Error("KRX 세션이 로그아웃 상태 — 로그인 실패 또는 세션 만료");
  let json: { OutBlock_1?: ShortBalanceRow[] };
  try {
    json = JSON.parse(text) as { OutBlock_1?: ShortBalanceRow[] };
  } catch {
    throw new Error(`KRX 응답 파싱 실패: ${text.slice(0, 200)}`);
  }
  return json.OutBlock_1 ?? [];
}

export interface KrxShortBalanceSummary {
  date: string; // YYYY-MM-DD
  marketWeightedRatio: number; // sum(BAL_AMT)/sum(MKTCAP) * 100, 시가총액가중 평균 공매도 잔고비중(%)
  top5: { name: string; ratio: number }[];
}

/** referenceDate부터 거슬러 올라가며 KOSPI 전종목 공매도 잔고를 찾아 시가총액가중 평균 비중과
 * 상위 5종목을 반환한다. KRX는 T+2 지연이라(공시 확인) 최근 며칠은 빈 데이터가 정상이다. */
export async function fetchKrxShortBalanceSummary(
  id: string,
  pw: string,
  referenceDate: Date = new Date(),
  maxLookback = 10
): Promise<KrxShortBalanceSummary | null> {
  const jar = await loginKrx(id, pw);

  for (let i = 0; i < maxLookback; i++) {
    const d = new Date(referenceDate);
    d.setUTCDate(d.getUTCDate() - i);
    const trdDd = toYYYYMMDDCompact(d);
    const rows = await fetchShortBalancePage(jar, trdDd, 1);
    if (rows.length === 0) continue;

    let totalBalAmt = 0;
    let totalMktCap = 0;
    for (const r of rows) {
      totalBalAmt += parseKrxNumber(r.BAL_AMT);
      totalMktCap += parseKrxNumber(r.MKTCAP);
    }
    if (totalMktCap === 0) continue;

    const top5 = [...rows]
      .map((r) => ({ name: r.ISU_ABBRV, ratio: parseKrxNumber(r.BAL_RTO) }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 5);

    return {
      date: `${trdDd.slice(0, 4)}-${trdDd.slice(4, 6)}-${trdDd.slice(6, 8)}`,
      marketWeightedRatio: (totalBalAmt / totalMktCap) * 100,
      top5,
    };
  }
  return null;
}
