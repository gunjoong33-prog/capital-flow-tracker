// 네이버금융 "종목분석 리포트" 목록 — 국내 증권사(신한투자증권 등) 리서치 원문 PDF 링크를 로그인
// 없이 무료로 모아준다. broker-consensus.ts와 같은 도메인(finance.naver.com)이라 접근 리스크가
// 가장 낮다. 페이지가 EUC-KR로 응답해서(실측 확인, broker-consensus.ts가 쓰는 item 페이지와 다름)
// TextDecoder로 직접 디코딩한다 — fetch().text()는 항상 UTF-8로 디코딩해 한글이 깨진다.
const NAVER_RESEARCH_URL = "https://finance.naver.com/research/company_list.naver";

export interface NaverResearchItem {
  stockName: string;
  title: string;
  broker: string;
  pdfUrl: string | null;
  date: string; // "YY.MM.DD" 원문 그대로(연도 앞자리 불명이라 임의로 20XX 붙이지 않는다)
}

/** 디코딩된 HTML 문자열을 파싱한다(순수 함수 — 인코딩과 분리해서 테스트하기 쉽게). */
export function parseNaverResearchHtml(html: string, limit: number): NaverResearchItem[] {
  const rowBlocks = html.match(/<tr>\s*<td style="padding-left:10">[\s\S]*?<\/tr>/g) ?? [];
  const items: NaverResearchItem[] = [];
  for (const block of rowBlocks.slice(0, limit)) {
    const stockName = block.match(/title="([^"]+)" class="stock_item"/)?.[1];
    const title = block.match(/company_read\.naver\?nid=\d+&page=1">([^<]+)</)?.[1];
    const broker = block.match(/<\/td>\s*<td>([^<]+)<\/td>/)?.[1]?.trim();
    const pdfUrl = block.match(/href="(https:\/\/stock\.pstatic\.net\/stock-research\/[^"]+\.pdf)"/)?.[1] ?? null;
    const date = block.match(/<td class="date"[^>]*>(\d{2}\.\d{2}\.\d{2})<\/td>/)?.[1];
    if (!stockName || !title || !broker || !date) continue;
    items.push({ stockName, title, broker, pdfUrl, date });
  }
  return items;
}

/** 최신 리포트 상위 limit건을 가져온다. 실패해도 던지지 않고 errors에 담는다. */
export async function fetchNaverResearch(limit = 10): Promise<{ items: NaverResearchItem[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch(NAVER_RESEARCH_URL, { headers: { "User-Agent": "Mozilla/5.0 (capital-flow-tracker personal use)" } });
    if (!res.ok) throw new Error(`네이버금융 리서치 조회 실패: ${res.status}`);
    const buf = await res.arrayBuffer();
    const html = new TextDecoder("euc-kr").decode(buf);
    const items = parseNaverResearchHtml(html, limit);
    if (items.length === 0) errors.push("네이버금융 리서치: 파싱 결과 0건(페이지 구조가 바뀌었을 수 있음)");
    return { items, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { items: [], errors };
  }
}
