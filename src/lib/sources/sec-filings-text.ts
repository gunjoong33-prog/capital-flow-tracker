// SEC EDGAR 최신 8-K 공시 원문에서 "Item N.NN ..." 섹션(사건 성격 요약)을 발췌한다. 실측 확인:
// 8-K 본문(primaryDocument)엔 재무 수치 전문이 아니라 "Exhibit 99.1을 보라"는 참조문뿐이고, 실제
// 수치는 별도 exhibit 문서에 있다 — 그래서 이 모듈이 주는 건 "무슨 성격의 공시가 떴는지"(실적 발표·
// 임원 변경·M&A 등 Item 분류)이지 재무제표 전문이 아니다. 과장하지 않는다.
import { BIG_TECH_TICKERS } from "@/lib/sources/types";

const SEC_USER_AGENT = "capital-flow-tracker personal research contact@example.com";

// sec-13f.ts의 TRACKED_HEDGE_FUNDS와 같은 방식(SEC 회사검색으로 확인한 CIK) — company_tickers.json을
// 매번 통째로(500KB+) 받는 대신 이미 알고 있는 빅테크7 CIK를 하드코딩한다.
export const TICKER_CIK: Record<string, string> = {
  AAPL: "320193",
  MSFT: "789019",
  GOOGL: "1652044",
  AMZN: "1018724",
  NVDA: "1045810",
  META: "1326801",
  TSLA: "1318605",
};

export interface SecFilingExcerpt {
  ticker: string;
  filingDate: string;
  url: string;
  excerpt: string; // "Item N.NN ..." 섹션 텍스트(최대 500자)
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

/** HTML 원문에서 첫 "Item N.NN ..." 섹션을 발췌한다(순수 함수). */
export function extractItemSection(html: string): string | null {
  const plain = decodeHtmlEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
  const match = plain.match(/Item\s+\d+\.\d+[^.]*\.[\s\S]{0,500}/);
  return match ? match[0].trim() : null;
}

/** 특정 티커의 최신 8-K에서 Item 섹션을 발췌한다. 실패해도 던지지 않고 errors에 담는다. */
export async function fetchLatest8KExcerpt(ticker: string): Promise<{ excerpt: SecFilingExcerpt | null; errors: string[] }> {
  const errors: string[] = [];
  const cik = TICKER_CIK[ticker];
  if (!cik) {
    errors.push(`SEC: ${ticker}의 CIK를 모름`);
    return { excerpt: null, errors };
  }
  try {
    const paddedCik = cik.padStart(10, "0");
    const subRes = await fetch(`https://data.sec.gov/submissions/CIK${paddedCik}.json`, { headers: { "User-Agent": SEC_USER_AGENT } });
    if (!subRes.ok) throw new Error(`SEC submissions 조회 실패: ${subRes.status}`);
    const sub = (await subRes.json()) as {
      filings: { recent: { form: string[]; accessionNumber: string[]; primaryDocument: string[]; filingDate: string[] } };
    };
    const { form, accessionNumber, primaryDocument, filingDate } = sub.filings.recent;
    const idx = form.findIndex((f) => f === "8-K");
    if (idx === -1) {
      errors.push(`SEC: ${ticker}에 최근 8-K 제출 없음`);
      return { excerpt: null, errors };
    }

    const accessionNoDashes = accessionNumber[idx].replace(/-/g, "");
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDashes}/${primaryDocument[idx]}`;
    const docRes = await fetch(docUrl, { headers: { "User-Agent": SEC_USER_AGENT } });
    if (!docRes.ok) throw new Error(`SEC 8-K 문서 조회 실패: ${docRes.status}`);
    const html = await docRes.text();
    const section = extractItemSection(html);
    if (!section) {
      errors.push(`SEC: ${ticker} 8-K에서 Item 섹션 못 찾음(문서 구조가 바뀌었을 수 있음)`);
      return { excerpt: null, errors };
    }

    return { excerpt: { ticker, filingDate: filingDate[idx], url: docUrl, excerpt: section }, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { excerpt: null, errors };
  }
}

/** 빅테크7 전체의 최신 8-K Item 섹션을 모은다. */
export async function fetchBigTech8KExcerpts(): Promise<{ excerpts: SecFilingExcerpt[]; errors: string[] }> {
  const errors: string[] = [];
  const excerpts: SecFilingExcerpt[] = [];
  for (const ticker of BIG_TECH_TICKERS) {
    const { excerpt, errors: tickerErrors } = await fetchLatest8KExcerpt(ticker);
    errors.push(...tickerErrors);
    if (excerpt) excerpts.push(excerpt);
  }
  return { excerpts, errors };
}
