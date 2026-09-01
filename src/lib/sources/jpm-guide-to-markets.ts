// JPMorgan Asset Management "Guide to the Markets" — 목록/내비게이션 페이지는 JS 렌더링이라
// 단순 fetch로 못 읽지만(실측 확인), 분기마다 갱신되는 PDF 자산 자체는 CMS가 "항상 최신판"으로
// 고정해 두는 URL이라 로그인 없이 직접 받을 수 있다(실측 확인, 2026-09). 과거 분기호 아카이브
// URL은 찾지 못해 최신판만 다룬다 — Last-Modified 헤더로 실제 갱신 여부를 함께 남긴다.
const PDF_URL =
  "https://am.jpmorgan.com/content/dam/jpm-am-aem/global/en/insights/market-insights/guide-to-the-markets/mi-guide-to-the-markets-us.pdf";
const USER_AGENT = "Mozilla/5.0 (capital-flow-tracker personal use)";

export interface JpmGuideToMarkets {
  title: string;
  url: string;
  lastModified: string | null;
}

/** 고정 PDF의 존재 여부와 최종 갱신일(Last-Modified)만 확인한다 — 본문은 못 읽으므로(PDF 텍스트
 * 추출 라이브러리 없음, 기존 관례) 링크·갱신일만 기록한다. HEAD로 충분해 본문을 내려받지 않는다. */
export async function fetchJpmGuideToMarkets(): Promise<{ guide: JpmGuideToMarkets | null; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch(PDF_URL, { method: "HEAD", headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`JPMorgan AM Guide to the Markets 조회 실패: ${res.status}`);
    return {
      guide: { title: "JPMorgan Asset Management — Guide to the Markets", url: PDF_URL, lastModified: res.headers.get("last-modified") },
      errors,
    };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { guide: null, errors };
  }
}
