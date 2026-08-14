import { dedupBySimilarTitle } from "@/lib/text-similarity";
import { BIG_TECH_TICKERS } from "@/lib/sources/types";

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

// 기존 3개는 전부 "... stock market/risk"처럼 시장 영향 표현이 검색어에 포함돼야만 잡혔다 —
// 그래서 "이란 공습" 같은 속보 자체(원 기사가 아직 "주식시장" 프레이밍을 안 달았을 때)가 통째로
// 빠지는 사각지대가 있었다. 지역/사건 자체를 겨냥한 검색어를 추가해 시장 프레이밍 유무와 무관하게
// 원 사건을 잡는다 — 리스크 여부·심각도 판정은 어차피 이후 Gemini가 하므로, 여기서는 폭넓게 모으고
// 거르는 건 뒤에서 하는 게 맞다.
const GEOPOLITICAL_QUERIES = [
  "war OR conflict stock market",
  "trade war tariff market",
  "election market risk",
  "military strike OR airstrike",
  "Iran OR Middle East conflict",
  "sanctions OR embargo",
  "central bank emergency OR bank failure OR sovereign default",
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
      fetchRss(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:2d&hl=en-US&gl=US&ceid=US:en`, "google-news", "general", 10)
    ),
    ...POWER_NETWORK_QUERIES.map((q) =>
      fetchRss(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:2d&hl=en-US&gl=US&ceid=US:en`, "google-news-power", "power-network", 5)
    ),
    fetchRss("https://www.federalreserve.gov/feeds/press_all.xml", "fed-press", "official", 10),
    fetchRss("https://www.federalreserve.gov/feeds/speeches_and_testimony.xml", "fed-speeches", "official", 10),
    fetchRss("https://www.whitehouse.gov/news/feed/", "whitehouse", "official", 10),
    // 구글 뉴스 검색어 매칭에 의존하지 않는 wire 서비스 직접 피드 — 검색어 사각지대를 보완한다.
    // 전부 무료·키 불필요·공개 RSS(비공식 API 아님, 각 언론사가 직접 제공하는 표준 RSS).
    fetchRss("https://feeds.bbci.co.uk/news/world/rss.xml", "bbc-world", "general", 15),
    fetchRss("https://www.aljazeera.com/xml/rss/all.xml", "aljazeera", "general", 15),
    fetchRss("https://feeds.a.dj.com/rss/RSSWorldNews.xml", "wsj-world", "general", 15),
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

  return { headlines: dedupOfficialHeadlines(deduped), errors };
}

/**
 * 백악관·연준 공식 발표는 같은 정책 액션에 대해 "Fact Sheet"·"Presidential Determination"·
 * "Executive Order"처럼 문서 종류만 다른 여러 건이 같이 올라오는 경우가 흔하다(예: DPA critical
 * minerals 관련 문서 2건). LLM judgeHeadlines()에 근접중복 병합 지침을 넣어뒀지만, 후보가
 * 144건까지 늘어난 상태에서는 이런 미묘한 중복을 가끔 놓친다 — official 카테고리는 건수가 적어서
 * (10~30건) 결정론적 제목 유사도 비교 비용이 낮다. 이 단계에서 먼저 걸러 LLM에는 대표 1건만
 * 넘긴다.
 */
function dedupOfficialHeadlines(headlines: Headline[]): Headline[] {
  const official = headlines.filter((h) => h.category === "official");
  const rest = headlines.filter((h) => h.category !== "official");
  return [...rest, ...dedupBySimilarTitle(official, (h) => h.title)];
}

// 빅테크 7 종목별 등락 원인 판정용 헤드라인 — 종목마다 별도 검색어로 조회해 티커별로 묶어서 반환한다
// (지정학 리스크용 fetchCandidateHeadlines와 달리 종목 단위 판정이라 결과를 티커로 구분해야 한다).
// 티커 목록은 BIG_TECH_TICKERS에서 그대로 가져온다 — 예전엔 여기 따로 하드코딩돼 있어서, types.ts에서
// 종목을 추가/제거해도 이 검색은 안 따라가는 드리프트 위험이 있었다(검색어 문구는 종목마다 사람이
// 손으로 다듬은 거라 Record로 유지).
const BIG_TECH_QUERY_TEXT: Record<string, string> = {
  AAPL: "Apple AAPL stock",
  MSFT: "Microsoft MSFT stock",
  GOOGL: "Google Alphabet GOOGL stock",
  AMZN: "Amazon AMZN stock",
  NVDA: "Nvidia NVDA stock",
  META: "Meta Platforms META stock",
  TSLA: "Tesla TSLA stock",
};

/** Google News의 when:Nd는 검색 "실행 시각" 기준 상대창이라, marketDate가 오늘보다 며칠 전이면
 * (주말·휴장일 지난 뒤 실행 등) when:1d로는 그날 뉴스를 못 찾는다 — asOf까지 확실히 포함되게
 * 창을 그만큼 넓힌다(같은 버그를 institutional-signals.ts 쪽 marketDate 미스와 동일 원인으로
 * 이미 한 번 겪었다). */
export async function fetchBigTechHeadlines(asOf: Date = new Date()): Promise<{
  byTicker: Record<string, Headline[]>;
  errors: string[];
}> {
  const errors: string[] = [];
  const byTicker: Record<string, Headline[]> = {};

  const daysBehind = Math.max(1, Math.ceil((Date.now() - asOf.getTime()) / 86_400_000) + 1);

  const results = await Promise.allSettled(
    BIG_TECH_TICKERS.map((ticker) =>
      fetchRss(
        `https://news.google.com/rss/search?q=${encodeURIComponent(BIG_TECH_QUERY_TEXT[ticker])}+when:${daysBehind}d&hl=en-US&gl=US&ceid=US:en`,
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

// ── /news 페이지: valley.town 실시간 속보와 동일한 필터 구성(전체/중요/주식/경제 발표/
// 중앙은행/뉴스) ─────────────────────
// 위 fetchCandidateHeadlines/fetchBigTechHeadlines는 영문(hl=en-US) 검색어 기반이라 판정용으로만
// 쓰지만, 뉴스 페이지는 사람이 직접 읽는 화면이라 한국어 결과(hl=ko&gl=KR)로 검색하고 실제 발행사
// 이름(<source> 태그)도 그대로 보여준다.
//
// "전체"·"중요"는 구글 뉴스에 실제로 검색을 던지는 카테고리가 아니다 — 아래 4개(주식/경제 발표/
// 중앙은행/뉴스)를 합친 가상 뷰다: "전체"는 4개를 시간순으로 합친 것, "중요"는 그중 추적 중인
// 종목이 매칭된(news-ticker-match.ts) 것만. news-page.ts의 getNewsPageCategory가 DB에서 이
// 두 뷰를 조립한다 — DB에는 4개 실제 카테고리로만 저장된다.
export type NewsPageCategoryKey = "all" | "important" | "stock" | "econ-release" | "central-bank" | "news";
export type FetchableCategoryKey = "stock" | "econ-release" | "central-bank" | "news";

interface FetchableCategory {
  key: FetchableCategoryKey;
  label: string;
  query: string;
}

export const FETCHABLE_CATEGORIES: FetchableCategory[] = [
  { key: "stock", label: "주식", query: "주식시장 증시" },
  { key: "econ-release", label: "경제 발표", query: "경제지표 발표" },
  { key: "central-bank", label: "중앙은행", query: "연준 한국은행 기준금리 통화정책" },
  { key: "news", label: "뉴스", query: "속보" },
];

// 탭 표시 순서 그대로 — valley.town 화면과 동일한 순서(전체/중요/주식/경제 발표/중앙은행/뉴스).
export const NEWS_PAGE_CATEGORIES: { key: NewsPageCategoryKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "important", label: "중요" },
  ...FETCHABLE_CATEGORIES.map(({ key, label }) => ({ key, label })),
];

export interface CategoryHeadline {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  // 아래 둘 다 DB(NewsPageHeadline)에서 읽을 때만 채워진다(computeAllNewsPageCategories의 라이브
  // RSS 파싱 결과에는 없음) — news-page.ts의 getNewsPageCategory가 채워 넣는다. category는
  // "전체"·"중요"처럼 여러 실카테고리가 섞인 뷰에서 행마다 실제 출처 카테고리를 보여주기 위함
  // (단일 카테고리 탭에서는 어차피 다 같은 값이라 화면에서 안 씀).
  tickers?: { ticker: string; changePct: number | null; asOfLabel: string | null }[];
  category?: FetchableCategoryKey;
}

function parseGoogleNewsItems(xml: string): CategoryHeadline[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.map((block) => {
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

async function fetchGoogleNewsRss(url: string): Promise<CategoryHeadline[]> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (capital-flow-tracker personal use)" } });
  if (!res.ok) throw new Error(`구글 뉴스 조회 실패: ${res.status}`);
  const xml = await res.text();
  return parseGoogleNewsItems(xml);
}

function searchUrlFor(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:2d&hl=ko&gl=KR&ceid=KR:ko`;
}

function dedupByUrl(...lists: CategoryHeadline[][]): CategoryHeadline[] {
  const seen = new Set<string>();
  const out: CategoryHeadline[] = [];
  for (const list of lists) {
    for (const h of list) {
      if (seen.has(h.url)) continue;
      seen.add(h.url);
      out.push(h);
    }
  }
  return out;
}

/**
 * /news 페이지의 실제 검색 카테고리(주식/경제 발표/중앙은행/뉴스) 4개만 구글 뉴스에서 가져온다 —
 * "전체"·"중요"는 이 4개를 DB에서 조합해 만드는 가상 뷰라 여기선 안 다룬다(news-page.ts의
 * getNewsPageCategory 참고). Groq 무료 티어 일일 할당량을 메인 리포트 파이프라인과 공유하므로
 * 페이지 방문마다 실시간 호출하면 안 되고, 이 함수를 하루 배치에서 딱 한 번만 호출해 DB
 * (NewsPageHeadline)에 저장한다.
 */
export async function computeAllNewsPageCategories(limit = 20): Promise<Record<FetchableCategoryKey, CategoryHeadline[]>> {
  const results = await Promise.all(
    FETCHABLE_CATEGORIES.map((c) => fetchGoogleNewsRss(searchUrlFor(c.query)))
  );

  // "속보"류 검색어는 같은 사건을 다룬 여러 매체의 사실상 동일한 제목이 우르르 몰려 나온다(실측:
  // "전체"·"뉴스" 탭 상위 8건 중 7건이 같은 소송 기사였음) — url만 다른 별개 기사라 dedupByUrl로는
  // 못 걸러진다. fetchCandidateHeadlines가 이미 쓰는 것과 같은 제목 유사도 dedup을 적용한다.
  const out = {} as Record<FetchableCategoryKey, CategoryHeadline[]>;
  FETCHABLE_CATEGORIES.forEach((c, i) => {
    out[c.key] = dedupBySimilarTitle(dedupByUrl(results[i]), (h) => h.title).slice(0, limit);
  });
  return out;
}
