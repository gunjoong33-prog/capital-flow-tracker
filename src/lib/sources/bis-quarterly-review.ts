// BIS Quarterly Review 특집기사 — 로그인·키 불필요, robots.txt 차단 없음(실측 확인, 2026-09).
// 인덱스 페이지(/publications/qr)에서 최신 발행호 슬러그(qr-YYYYMM, 3/6/9/12월 분기 발행)를 찾고,
// 그 발행호 페이지에 서버 렌더링돼 있는 특집기사 카드(제목·날짜·슬러그)를 읽는다. 발행호 자체의
// 통합 PDF는 항상 https://www.bis.org/publications/{슬러그}.pdf 로 고정 — 기존 bis.ts(SDMX 수치
// API, sourceType "bis")와는 다른 소스이므로 sourceType을 "bis_qr"로 분리한다.
import { decodeXmlEntities } from "@/lib/sources/news-feeds";

const BIS_INDEX_URL = "https://www.bis.org/publications/qr";
const USER_AGENT = "Mozilla/5.0 (capital-flow-tracker personal use)";

export interface BisArticle {
  title: string;
  url: string;
  publishedAt: string | null;
}

/** 인덱스 페이지에서 가장 최신 발행호 슬러그(예: "qr-202606")를 찾는다. YYYYMM 형식이라 문자열
 * 정렬 최댓값이 곧 최신호다. */
export function parseBisIndexHtml(html: string): string | null {
  const slugs = [...html.matchAll(/href="\/publications\/(qr-\d{6})"/g)].map((m) => m[1]);
  if (slugs.length === 0) return null;
  return [...slugs].sort().at(-1) ?? null;
}

/** 발행호 페이지의 특집기사 카드를 파싱한다. 카드는 `<div class="card-wrapper` 블록 안에
 * `<a href="/publications/{slug}" class="card-link">` + `card-date fs-sm` + `card-heading`로
 * 서버 렌더링돼 있다(실측 확인) — 날짜가 없는 블록은 기사 카드가 아닌 다른 내비게이션 요소일
 * 가능성이 높아 제외한다. */
export function parseBisIssueHtml(html: string, limit: number): BisArticle[] {
  const blocks = html.split('<div class="card-wrapper').slice(1);
  const articles: BisArticle[] = [];
  for (const block of blocks) {
    const slug = block.match(/<a href="(\/publications\/[^"]+)" class="card-link"/)?.[1];
    const dateText = block.match(/class="card-date fs-sm">([^<]+)</)?.[1];
    const titleRaw = block.match(/class="card-heading">([^<]+)</)?.[1];
    if (!slug || !dateText || !titleRaw) continue;
    articles.push({ title: decodeXmlEntities(titleRaw.trim()), url: `https://www.bis.org${slug}`, publishedAt: dateText.trim() });
    if (articles.length >= limit) break;
  }
  return articles;
}

/** 최신 발행호의 특집기사 상위 limit건을 가져온다. 실패해도 던지지 않고 errors에 담는다. */
export async function fetchBisQuarterlyReview(limit = 5): Promise<{ articles: BisArticle[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const indexRes = await fetch(BIS_INDEX_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!indexRes.ok) throw new Error(`BIS Quarterly Review 색인 조회 실패: ${indexRes.status}`);
    const latestSlug = parseBisIndexHtml(await indexRes.text());
    if (!latestSlug) {
      errors.push("BIS Quarterly Review: 최신 발행호 링크 못 찾음(색인 페이지 구조가 바뀌었을 수 있음)");
      return { articles: [], errors };
    }

    const issueRes = await fetch(`https://www.bis.org/publications/${latestSlug}`, { headers: { "User-Agent": USER_AGENT } });
    if (!issueRes.ok) throw new Error(`BIS 발행호(${latestSlug}) 조회 실패: ${issueRes.status}`);
    const articles = parseBisIssueHtml(await issueRes.text(), limit);
    if (articles.length === 0) errors.push(`BIS 발행호(${latestSlug}): 기사 파싱 결과 0건(페이지 구조가 바뀌었을 수 있음)`);
    return { articles, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { articles: [], errors };
  }
}
