// PIMCO Insights 페이지 상단 내비게이션에 "Secular Outlook"·"Cyclical Outlook" 최신 글 링크가
// 고정 라벨로 항상 노출된다(로그인·키 불필요). 슬러그가 발행 때마다 바뀌므로 매번 이 페이지에서
// 최신 링크를 다시 읽어야 한다 — 개별 기사 URL을 하드코딩하지 않는다.
const PIMCO_INSIGHTS_URL = "https://www.pimco.com/us/en/insights";
const LABELS = ["Secular Outlook", "Cyclical Outlook"] as const;

export interface PimcoOutlook {
  label: (typeof LABELS)[number];
  url: string;
}

/** 최신 Secular/Cyclical Outlook 링크를 가져온다. 실패해도 던지지 않고 errors에 담는다. */
export async function fetchPimcoOutlooks(): Promise<{ outlooks: PimcoOutlook[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch(PIMCO_INSIGHTS_URL, { headers: { "User-Agent": "Mozilla/5.0 (capital-flow-tracker personal use)" } });
    if (!res.ok) throw new Error(`PIMCO 조회 실패: ${res.status}`);
    const html = await res.text();
    const outlooks: PimcoOutlook[] = [];
    for (const label of LABELS) {
      const re = new RegExp(`<a href="([^"]+)"[^>]*data-datalayer-clicktext="${label}"`, "i");
      const match = html.match(re);
      if (match) outlooks.push({ label, url: new URL(match[1], PIMCO_INSIGHTS_URL).toString() });
    }
    if (outlooks.length === 0) errors.push("PIMCO: Secular/Cyclical Outlook 링크 못 찾음(페이지 구조가 바뀌었을 수 있음)");
    return { outlooks, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { outlooks: [], errors };
  }
}
