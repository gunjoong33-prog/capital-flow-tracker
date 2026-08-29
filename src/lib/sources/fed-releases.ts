// 미 연준(Federal Reserve) 공식 RSS 2개(보도자료 전체 + 연설/증언)를 합쳐 최신 N건을 가져온다.
// 로그인·키 불필요 — federalreserve.gov가 공식 제공하는 무료 RSS(federalreserve.gov/feeds/feeds.htm).
import { extractTag } from "@/lib/sources/news-feeds";

export interface FedRelease {
  title: string;
  url: string;
  publishedAt: string | null;
  kind: "press" | "speech";
}

const FEEDS: { url: string; kind: FedRelease["kind"] }[] = [
  { url: "https://www.federalreserve.gov/feeds/press_all.xml", kind: "press" },
  { url: "https://www.federalreserve.gov/feeds/speeches.xml", kind: "speech" },
];

function parseItems(xml: string, kind: FedRelease["kind"]): FedRelease[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items
    .map((block) => ({
      title: extractTag(block, "title") ?? "",
      url: extractTag(block, "link") ?? "",
      publishedAt: extractTag(block, "pubDate"),
      kind,
    }))
    .filter((r) => r.title && r.url);
}

/** 두 피드를 합쳐 최신순 상위 limit건을 반환한다. 개별 피드 실패는 던지지 않고 errors에 담는다. */
export async function fetchFedReleases(limit = 5): Promise<{ releases: FedRelease[]; errors: string[] }> {
  const errors: string[] = [];
  const all: FedRelease[] = [];

  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: { "User-Agent": "Mozilla/5.0 (capital-flow-tracker personal use)" } });
      if (!res.ok) throw new Error(`연준 ${feed.kind} RSS 조회 실패: ${res.status}`);
      all.push(...parseItems(await res.text(), feed.kind));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const releases = all
    .sort((a, b) => (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0))
    .slice(0, limit);
  if (releases.length === 0 && errors.length === 0) errors.push("연준: 두 피드 모두 항목 0건(포맷이 바뀌었을 수 있음)");

  return { releases, errors };
}
