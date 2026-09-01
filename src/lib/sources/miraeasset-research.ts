// 미래에셋증권 리서치 리포트 — 로그인 불필요, 목록 페이지가 서버 렌더링 HTML로 그대로 옴(실측
// 확인, 2026-09 — 이전 세션엔 "JS 렌더링이라 미확인"으로 잘못 판정됐었음). naver-research.ts와
// 같은 이유로 EUC-KR 응답이라 TextDecoder로 직접 디코딩한다. 제목은 별도 텍스트 노드가 아니라
// PDF 다운로드 링크의 title 속성(예: "20260901_ETF 전략.pdf(새창열림)")에만 있다.
import { decodeXmlEntities } from "@/lib/sources/news-feeds";

const LIST_URL = "https://securities.miraeasset.com/bbs/board/message/list.do?categoryId=1521";
const USER_AGENT = "Mozilla/5.0 (capital-flow-tracker personal use)";

export interface MiraeassetReport {
  title: string;
  url: string;
  date: string; // "YYYYMMDD" 원문 그대로
}

/** 디코딩된 HTML 문자열을 파싱한다(순수 함수 — 인코딩과 분리해서 테스트하기 쉽게). */
export function parseMiraeassetHtml(html: string, limit: number): MiraeassetReport[] {
  const re = /downConfirm\('([^']+\.pdf)\?attachmentId=\d+'[^>]*title="(\d{8})_([^"]+?)\.pdf\(새창열림\)"/g;
  const items: MiraeassetReport[] = [];
  for (const m of html.matchAll(re)) {
    items.push({ url: m[1], date: m[2], title: decodeXmlEntities(m[3].trim()) });
    if (items.length >= limit) break;
  }
  return items;
}

/** 최신 리포트 상위 limit건을 가져온다. 실패해도 던지지 않고 errors에 담는다. */
export async function fetchMiraeassetResearch(limit = 10): Promise<{ items: MiraeassetReport[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch(LIST_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`미래에셋증권 리서치 조회 실패: ${res.status}`);
    const buf = await res.arrayBuffer();
    const html = new TextDecoder("euc-kr").decode(buf);
    const items = parseMiraeassetHtml(html, limit);
    if (items.length === 0) errors.push("미래에셋증권 리서치: 파싱 결과 0건(페이지 구조가 바뀌었을 수 있음)");
    return { items, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { items: [], errors };
  }
}
