// RSS 헤드라인 수집 — 뉴스 API 없이 표준 RSS 피드만 쓴다(무료, 키 불필요).
// Google News RSS: 검색어 기반 공개 RSS(비공식이지만 안정적으로 유지돼온 포맷).
// 연준 보도자료·연설/증언, 백악관 뉴스: 각 기관 공식 RSS 피드
// (federalreserve.gov/feeds/feeds.htm, whitehouse.gov/news/feed/ 에서 확인).
// v2 프롬프트 1단계 원문이 "Bloomberg ASIA·백악관·Fed"를 직접 지정한 소스라 그대로 반영.

// 1단계 뉴스 우선순위(사용자 지정): 0=백악관·연준 공식 발표, 1=권력 네트워크·엘리트 그룹 유출/폭로
// (예: Peter Thiel 'Dialog' 비밀결사 유출 보도류), 2=그 외 일반 지정학 뉴스(구글 검색).
export type NewsCategory = "official" | "power-network" | "general";

export interface Headline {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  category: NewsCategory;
}

export function decodeXmlEntities(text: string): string {
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

function parseRssItems(xml: string, source: string, category: NewsCategory, limit: number): Headline[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.slice(0, limit).map((block) => ({
    title: extractTag(block, "title") ?? "",
    url: extractTag(block, "link") ?? "",
    source,
    category,
    publishedAt: extractTag(block, "pubDate"),
  })).filter((h) => h.title && h.url);
}

async function fetchRss(url: string, source: string, category: NewsCategory, limit: number): Promise<Headline[]> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (capital-flow-tracker personal use)" } });
  if (!res.ok) throw new Error(`${source} RSS 조회 실패: ${res.status}`);
  const xml = await res.text();
  return parseRssItems(xml, source, category, limit);
}

const GEOPOLITICAL_QUERIES = [
  "war OR conflict stock market",
  "trade war tariff market",
  "election market risk",
];

// 사용자가 예시로 준 기사(Peter Thiel 'Dialog' 비밀결사 유출 보도 등) 같은 "권력 네트워크·엘리트 집단
// 유출/폭로"류 뉴스. 이런 건 특정 사건이라 매번 같은 키워드로 다시 잡히진 않지만, 비슷한 성격의
// 후속 보도를 최대한 넓게 잡으려고 광범위한 주제어로 검색한다.
const POWER_NETWORK_QUERIES = [
  "leaked documents expose elite network",
  "secret society members leaked",
  "investigation exposes influence network politicians",
];

/** 지정학 리스크 후보 헤드라인 — Google News RSS 검색 몇 개 + 연준·백악관 공식 보도자료. 판정은 이후 LLM이 한다. */
export async function fetchCandidateHeadlines(): Promise<{ headlines: Headline[]; errors: string[] }> {
  const errors: string[] = [];
  const headlines: Headline[] = [];

  const results = await Promise.allSettled([
    ...GEOPOLITICAL_QUERIES.map((q) =>
      fetchRss(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:2d&hl=en-US&gl=US&ceid=US:en`, "google-news", "general", 5)
    ),
    ...POWER_NETWORK_QUERIES.map((q) =>
      fetchRss(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:2d&hl=en-US&gl=US&ceid=US:en`, "google-news-power", "power-network", 5)
    ),
    fetchRss("https://www.federalreserve.gov/feeds/press_all.xml", "fed-press", "official", 10),
    fetchRss("https://www.federalreserve.gov/feeds/speeches_and_testimony.xml", "fed-speeches", "official", 10),
    fetchRss("https://www.whitehouse.gov/news/feed/", "whitehouse", "official", 10),
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

// 빅테크 7 종목별 등락 원인 판정용 헤드라인 — 종목마다 별도 검색어로 조회해 티커별로 묶어서 반환한다
// (지정학 리스크용 fetchCandidateHeadlines와 달리 종목 단위 판정이라 결과를 티커로 구분해야 한다).
const BIG_TECH_QUERIES: { ticker: string; query: string }[] = [
  { ticker: "AAPL", query: "Apple AAPL stock" },
  { ticker: "MSFT", query: "Microsoft MSFT stock" },
  { ticker: "GOOGL", query: "Google Alphabet GOOGL stock" },
  { ticker: "AMZN", query: "Amazon AMZN stock" },
  { ticker: "NVDA", query: "Nvidia NVDA stock" },
  { ticker: "META", query: "Meta Platforms META stock" },
  { ticker: "TSLA", query: "Tesla TSLA stock" },
];

export async function fetchBigTechHeadlines(): Promise<{
  byTicker: Record<string, Headline[]>;
  errors: string[];
}> {
  const errors: string[] = [];
  const byTicker: Record<string, Headline[]> = {};

  const results = await Promise.allSettled(
    BIG_TECH_QUERIES.map(({ ticker, query }) =>
      fetchRss(
        `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:1d&hl=en-US&gl=US&ceid=US:en`,
        `google-news-${ticker}`,
        "general",
        3
      ).then((headlines) => ({ ticker, headlines }))
    )
  );

  for (const r of results) {
    if (r.status === "fulfilled") byTicker[r.value.ticker] = r.value.headlines;
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }

  return { byTicker, errors };
}

// ── /news 페이지: 주제별 구글 뉴스 헤드라인 ─────────────────────
// 위 fetchCandidateHeadlines/fetchBigTechHeadlines는 영문(hl=en-US) 검색어 기반이라 판정용으로만
// 쓰지만, 뉴스 페이지는 사람이 직접 읽는 화면이라 한국어 결과(hl=ko&gl=KR)로 검색하고 실제 발행사
// 이름(<source> 태그)도 그대로 보여준다.
export type NewsPageCategoryKey = "world-politics" | "world-economy" | "domestic-politics" | "domestic-economy" | "tech";

export const NEWS_PAGE_CATEGORIES: { key: NewsPageCategoryKey; label: string; query: string }[] = [
  { key: "world-politics", label: "세계 정치", query: "국제 정치" },
  { key: "world-economy", label: "세계 경제", query: "세계 경제" },
  { key: "domestic-politics", label: "국내 정치", query: "국내 정치" },
  { key: "domestic-economy", label: "국내 경제", query: "국내 경제" },
  { key: "tech", label: "기술", query: "IT 기술" },
];

export interface CategoryHeadline {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

function parseGoogleNewsItems(xml: string, limit: number): CategoryHeadline[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.slice(0, limit).map((block) => {
    const rawTitle = extractTag(block, "title") ?? "";
    const source = extractTag(block, "source") ?? "Google News";
    // 구글 뉴스 RSS는 title 끝에 " - 발행사명"을 항상 덧붙인다 — source를 따로 보여주므로 중복 제거.
    const title = rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
    return {
      title,
      url: extractTag(block, "link") ?? "",
      source,
      publishedAt: extractTag(block, "pubDate"),
    };
  }).filter((h) => h.title && h.url);
}

export async function fetchNewsPageCategory(key: NewsPageCategoryKey, limit = 20): Promise<CategoryHeadline[]> {
  const category = NEWS_PAGE_CATEGORIES.find((c) => c.key === key);
  if (!category) throw new Error(`알 수 없는 뉴스 카테고리: ${key}`);
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(category.query)}+when:2d&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (capital-flow-tracker personal use)" } });
  if (!res.ok) throw new Error(`구글 뉴스 조회 실패: ${res.status}`);
  const xml = await res.text();
  return parseGoogleNewsItems(xml, limit);
}
