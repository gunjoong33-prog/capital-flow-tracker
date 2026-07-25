// RSS 헤드라인 수집 — 뉴스 API 없이 표준 RSS 피드만 쓴다(무료, 키 불필요).
// Google News RSS: 검색어 기반 공개 RSS(비공식이지만 안정적으로 유지돼온 포맷).
// 연준 보도자료·연설/증언, 백악관 뉴스: 각 기관 공식 RSS 피드
// (federalreserve.gov/feeds/feeds.htm, whitehouse.gov/news/feed/ 에서 확인).
// v2 프롬프트 1단계 원문이 "Bloomberg ASIA·백악관·Fed"를 직접 지정한 소스라 그대로 반영.

export interface Headline {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractTag(block: string, tag: string): string | null {
  const cdataMatch = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"));
  if (cdataMatch) return decodeXmlEntities(cdataMatch[1].trim());
  const plainMatch = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return plainMatch ? decodeXmlEntities(plainMatch[1].trim()) : null;
}

function parseRssItems(xml: string, source: string, limit: number): Headline[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.slice(0, limit).map((block) => ({
    title: extractTag(block, "title") ?? "",
    url: extractTag(block, "link") ?? "",
    source,
    publishedAt: extractTag(block, "pubDate"),
  })).filter((h) => h.title && h.url);
}

async function fetchRss(url: string, source: string, limit: number): Promise<Headline[]> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (capital-flow-tracker personal use)" } });
  if (!res.ok) throw new Error(`${source} RSS 조회 실패: ${res.status}`);
  const xml = await res.text();
  return parseRssItems(xml, source, limit);
}

const GEOPOLITICAL_QUERIES = [
  "war OR conflict stock market",
  "trade war tariff market",
  "election market risk",
];

/** 지정학 리스크 후보 헤드라인 — Google News RSS 검색 몇 개 + 연준 공식 보도자료. 판정은 이후 LLM이 한다. */
export async function fetchCandidateHeadlines(): Promise<{ headlines: Headline[]; errors: string[] }> {
  const errors: string[] = [];
  const headlines: Headline[] = [];

  const results = await Promise.allSettled([
    ...GEOPOLITICAL_QUERIES.map((q) =>
      fetchRss(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:2d&hl=en-US&gl=US&ceid=US:en`, "google-news", 5)
    ),
    fetchRss("https://www.federalreserve.gov/feeds/press_all.xml", "fed-press", 10),
    fetchRss("https://www.federalreserve.gov/feeds/speeches_and_testimony.xml", "fed-speeches", 10),
    fetchRss("https://www.whitehouse.gov/news/feed/", "whitehouse", 10),
  ]);

  for (const r of results) {
    if (r.status === "fulfilled") headlines.push(...r.value);
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }

  // 같은 기사가 여러 검색어에 중복으로 잡힐 수 있어 URL 기준 중복 제거
  const seen = new Set<string>();
  const deduped = headlines.filter((h) => {
    if (seen.has(h.url)) return false;
    seen.add(h.url);
    return true;
  });

  return { headlines: deduped, errors };
}
