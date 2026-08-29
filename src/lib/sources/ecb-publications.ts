// ECB(유럽중앙은행) 공식 RSS 하나로 보도자료·연설·통화정책회의 결과가 전부 섞여 나온다
// (ecb.europa.eu/rss/press.html) — 로그인·키 불필요.
import { extractTag } from "@/lib/sources/news-feeds";

export interface EcbPublication {
  title: string;
  url: string;
  publishedAt: string | null;
}

const ECB_RSS_URL = "https://www.ecb.europa.eu/rss/press.html";

/** 최신 N건을 가져온다. 실패해도 던지지 않고 errors에 담는다. */
export async function fetchEcbPublications(limit = 5): Promise<{ publications: EcbPublication[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch(ECB_RSS_URL, { headers: { "User-Agent": "Mozilla/5.0 (capital-flow-tracker personal use)" } });
    if (!res.ok) throw new Error(`ECB RSS 조회 실패: ${res.status}`);
    const xml = await res.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const publications = items
      .slice(0, limit)
      .map((block) => ({
        title: extractTag(block, "title") ?? "",
        url: extractTag(block, "link") ?? "",
        publishedAt: extractTag(block, "pubDate"),
      }))
      .filter((p) => p.title && p.url);
    if (publications.length === 0) errors.push("ECB: RSS 항목 0건(포맷이 바뀌었을 수 있음)");
    return { publications, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { publications: [], errors };
  }
}
