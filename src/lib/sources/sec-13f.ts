// SEC EDGAR 13F(헤지펀드 분기별 포지셔닝) — 완전 무료·공식이지만 API 키 없이 대량 요청하면 막히므로
// User-Agent에 연락처를 명시하는 SEC 요구사항을 지킨다. 최신 13F-HR 제출 하나만 가져온다(분기 대비
// 증감은 오케스트레이션 계층에서 지난 분기 DB 저장값과 비교 — 이 모듈은 단일 시점 스냅샷만 책임진다).
const SEC_USER_AGENT = "capital-flow-tracker personal research contact@example.com";

export interface Holding {
  nameOfIssuer: string;
  cusip: string;
  valueThousands: number;
  shares: number;
}

// Dataroma가 이미 커버하는 "슈퍼 투자자"(버핏류 개인 가치투자자)와 겹치지 않게, 매크로 성향이 강한
// 대형 헤지펀드 위주로 고른다 — CIK는 SEC EDGAR 회사검색에서 확인한 값.
export const TRACKED_HEDGE_FUNDS: { name: string; cik: string }[] = [
  { name: "Bridgewater Associates", cik: "0001350694" },
  { name: "Citadel Advisors", cik: "0001423053" },
  { name: "Millennium Management", cik: "0001273087" },
  { name: "Renaissance Technologies", cik: "0001037389" },
];

function paddedCik(cik: string): string {
  return cik.replace(/^0*/, "").padStart(10, "0");
}

function parseInfoTable(xml: string): Holding[] {
  const blocks = xml.match(/<infoTable>[\s\S]*?<\/infoTable>/g) ?? [];
  const holdings: Holding[] = [];
  for (const block of blocks) {
    const name = block.match(/<nameOfIssuer>([^<]+)<\/nameOfIssuer>/)?.[1]?.trim();
    const cusip = block.match(/<cusip>([^<]+)<\/cusip>/)?.[1]?.trim();
    const value = block.match(/<value>([^<]+)<\/value>/)?.[1];
    const shares = block.match(/<sshPrnamt>([^<]+)<\/sshPrnamt>/)?.[1];
    if (!name || !cusip || value === undefined || shares === undefined) continue;
    holdings.push({ nameOfIssuer: name, cusip, valueThousands: Number(value), shares: Number(shares) });
  }
  return holdings;
}

/** 특정 헤지펀드(CIK)의 최신 13F-HR 보유내역을 가져온다. 실패해도 던지지 않고 errors에 담는다. */
export async function fetchHedgeFundHoldings(
  cik: string
): Promise<{ holdings: Holding[]; filingDate: string | null; errors: string[] }> {
  const errors: string[] = [];
  try {
    const subRes = await fetch(`https://data.sec.gov/submissions/CIK${paddedCik(cik)}.json`, {
      headers: { "User-Agent": SEC_USER_AGENT },
    });
    if (!subRes.ok) throw new Error(`SEC submissions 조회 실패: ${subRes.status}`);
    const sub = (await subRes.json()) as {
      filings: { recent: { form: string[]; accessionNumber: string[]; primaryDocument: string[]; filingDate: string[] } };
    };
    const { form, accessionNumber, primaryDocument, filingDate } = sub.filings.recent;
    const idx = form.findIndex((f) => f === "13F-HR");
    if (idx === -1) {
      errors.push(`SEC: CIK ${cik}에 최근 13F-HR 제출 없음`);
      return { holdings: [], filingDate: null, errors };
    }

    const accessionNoDashes = accessionNumber[idx].replace(/-/g, "");
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDashes}/${primaryDocument[idx]}`;
    const docRes = await fetch(docUrl, { headers: { "User-Agent": SEC_USER_AGENT } });
    if (!docRes.ok) throw new Error(`SEC 13F 문서 조회 실패: ${docRes.status}`);
    const xml = await docRes.text();
    const holdings = parseInfoTable(xml);
    if (holdings.length === 0) errors.push(`SEC: CIK ${cik} 13F 파싱 결과 0건(문서 구조가 바뀌었을 수 있음)`);

    return { holdings, filingDate: filingDate[idx], errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { holdings: [], filingDate: null, errors };
  }
}
