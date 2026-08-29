// BlackRock Investment Institute "Weekly market commentary"는 로그인 없이 공개되는 상시 갱신
// 단일 페이지다(목록이 아니라 그 자체가 최신호). 매주 h1(고정 제목) 아래 h2(그 주의 부제)가
// 바뀌는 방식이라, 둘을 합쳐 그 주의 실제 헤드라인으로 쓴다.
const BLACKROCK_URL = "https://www.blackrock.com/us/individual/insights/blackrock-investment-institute/weekly-commentary";

export interface BlackrockCommentary {
  title: string;
  url: string;
}

/** 이번 주 Weekly market commentary 제목을 가져온다. 실패해도 던지지 않고 errors에 담는다. */
export async function fetchBlackrockCommentary(): Promise<{ commentary: BlackrockCommentary | null; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch(BLACKROCK_URL, { headers: { "User-Agent": "Mozilla/5.0 (capital-flow-tracker personal use)" } });
    if (!res.ok) throw new Error(`BlackRock 조회 실패: ${res.status}`);
    const html = await res.text();
    const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim();
    const h2 = html.match(/<h2[^>]*>([^<]+)<\/h2>/)?.[1]?.trim();
    if (!h1) {
      errors.push("BlackRock: 제목 못 찾음(페이지 구조가 바뀌었을 수 있음)");
      return { commentary: null, errors };
    }
    return { commentary: { title: h2 ? `${h1}: ${h2}` : h1, url: BLACKROCK_URL }, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { commentary: null, errors };
  }
}
