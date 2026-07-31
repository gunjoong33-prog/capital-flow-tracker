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

const STOPWORDS = new Set([
  "the", "a", "an", "of", "on", "in", "to", "for", "with", "and", "or", "as", "is", "are", "that",
  "this", "by", "from", "at", "be", "was", "were", "has", "have", "had", "will", "would", "our",
  "their", "its", "president", "donald", "trump",
]);

function significantTokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 백악관·연준 공식 발표는 같은 정책 액션에 대해 "Fact Sheet"·"Presidential Determination"·
 * "Executive Order"처럼 문서 종류만 다른 여러 건이 같이 올라오는 경우가 흔하다(예: DPA critical
 * minerals 관련 문서 2건). Gemini judgeHeadlines()에 근접중복 병합 지침을 넣어뒀지만, 후보가
 * 144건까지 늘어난 상태에서는 이런 미묘한 중복을 가끔 놓친다 — official 카테고리는 건수가 적어서
 * (10~30건) 결정론적 제목 유사도 비교 비용이 낮다. 이 단계에서 먼저 걸러 Gemini에는 대표 1건만
 * 넘긴다.
 */
function dedupOfficialHeadlines(headlines: Headline[]): Headline[] {
  const official = headlines.filter((h) => h.category === "official");
  const rest = headlines.filter((h) => h.category !== "official");
  const kept: Headline[] = [];
  for (const h of official) {
    const tokens = significantTokens(h.title);
    const isDup = kept.some((k) => jaccardSimilarity(tokens, significantTokens(k.title)) >= 0.25);
    if (!isDup) kept.push(h);
  }
  return [...rest, ...kept];
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

// 구글 뉴스 자체 "토픽" 피드(뉴스 홈 상단 탭 — 세계·비즈니스 등) ID. 검색어 기반(q=...)이 아니라
// 구글이 자체 편집 알고리즘으로 큐레이션한 섹션이라, "정치"·"경제" 같은 흔한 단어만 봐도 매칭되는
// 검색 방식보다 훨씬 정확하다 — 봉화군 박람회 같은 무관한 지역 뉴스가 애초에 안 섞인다. 토픽 ID는
// news.google.com 페이지 상단 탭의 실제 href에서 그대로 가져온 값(언어와 무관하게 안정적).
const GOOGLE_NEWS_TOPIC_IDS: Partial<Record<NewsPageCategoryKey, string>> = {
  "world-politics": "CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtdHZHZ0pMVWlnQVAB", // 세계(World)
  "world-economy": "CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtdHZHZ0pMVWlnQVAB", // 비즈니스(Business)
};

// "대한민국"(Korea) 토픽 — 세계/비즈니스와 달리 정치·경제로 나뉘어 있지 않고 "한국 전체 주요
// 뉴스"라 폭염·범죄·지역 뉴스 비중이 크다(실측: 70건 중 46건이 정치·경제 키워드 어디에도 안 걸림).
// 그래서 이 토픽만 단독으로 쓰면 세계 카테고리와 달리 오히려 품질이 떨어진다 — 대신 기존 검색어
// 기반 결과와 합쳐 후보 풀을 넓히고, 카테고리별 키워드 필터로 정치/경제를 가른다.
const DOMESTIC_TOPIC_ID = "CAAqIQgKIhtDQkFTRGdvSUwyMHZNRFp4WkRNU0FtdHZLQUFQAQ";

export interface CategoryHeadline {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
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

// "국내 정치"/"국제 정치" 같은 검색어가 너무 넓어서(구글 뉴스가 "정치"·"경제" 단어만 봐도
// 매칭시킴) 박람회·강좌·기념식·연구 발표처럼 자본흐름과 무관한 지역/행정 뉴스가 다수 섞였다 —
// 국내 카테고리만 필터링했더니 "세계 정치" 탭에서도 똑같이 무관한 지역 뉴스(예: "봉화군 국제
// 수면치유박람회")가 나와서 세계 카테고리에도 같은 필터를 적용한다. 제외 목록은 무한히 늘어나는
// 예외를 다 못 잡으니, 대신 "이 사이트가 실제로 다루는 주제와 관련 있는가"를 포함 키워드로
// 판정한다 — 아래 키워드가 하나도 없으면 노출하지 않는다. "기술" 카테고리는 제외한다 — 그
// 자체가 이미 좁은 주제 버킷이라 경제·정치 키워드로 거르면 정상적인 기술 뉴스까지 잘려나간다.
// 짧고 흔한 낱말은 무관한 복합어 안에 우연히 포함돼 오탐을 낸다 — 예: "산업"은 "치유산업"(수면치유
// 박람회 기사)에도 걸리고, "재정"은 "재정비"(도시 재정비 기사)에도 걸린다. 부분 문자열 매칭이라
// 이런 키워드는 목록에서 뺐다 — 대신 "기업"·"실적"·"매출" 등 산업 관련 실제 뉴스는 다른 키워드로도
// 대부분 걸린다.
// 대한민국 토픽은 정치/경제로 안 나뉘어 있어 카테고리별로 직접 걸러야 한다 — 두 목록에 겹치는
// 키워드(경제·정책 등)가 있어도 무방하다(어느 한쪽에라도 걸리면 해당 탭 후보로 채택).
const DOMESTIC_RELEVANCE_KEYWORDS: Partial<Record<NewsPageCategoryKey, string[]>> = {
  "domestic-politics": [
    "대통령", "국회", "법안", "총리", "개각", "여당", "야당", "선거", "정치", "탄핵", "청문회",
    "전쟁", "분쟁", "충돌", "공습", "제재", "정상회담", "외교", "협정", "동맹", "무력", "군사",
  ],
  "domestic-economy": [
    "금리", "환율", "증시", "주가", "코스피", "코스닥", "국채", "채권", "수출", "수입", "무역", "관세",
    "GDP", "성장률", "물가", "인플레", "실업", "고용", "부동산", "규제", "정책", "투자", "외국인",
    "연기금", "국민연금", "세금", "과세", "예산", "통화", "한은", "기준금리", "경제", "기업",
    "반도체", "자산", "펀드", "은행", "증권", "상장", "IPO", "인수합병", "실적", "매출", "영업이익", "적자", "흑자",
  ],
};

async function fetchGoogleNewsRss(url: string): Promise<CategoryHeadline[]> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (capital-flow-tracker personal use)" } });
  if (!res.ok) throw new Error(`구글 뉴스 조회 실패: ${res.status}`);
  const xml = await res.text();
  return parseGoogleNewsItems(xml);
}

export async function fetchNewsPageCategory(key: NewsPageCategoryKey, limit = 20): Promise<CategoryHeadline[]> {
  const category = NEWS_PAGE_CATEGORIES.find((c) => c.key === key);
  if (!category) throw new Error(`알 수 없는 뉴스 카테고리: ${key}`);
  const searchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(category.query)}+when:2d&hl=ko&gl=KR&ceid=KR:ko`;

  const domesticKeywords = DOMESTIC_RELEVANCE_KEYWORDS[key];
  if (domesticKeywords) {
    const topicUrl = `https://news.google.com/rss/topics/${DOMESTIC_TOPIC_ID}?hl=ko&gl=KR&ceid=KR:ko`;
    const [topicItems, searchItems] = await Promise.all([
      fetchGoogleNewsRss(topicUrl),
      fetchGoogleNewsRss(searchUrl),
    ]);
    const seen = new Set<string>();
    const merged = [...topicItems, ...searchItems].filter((h) => {
      if (seen.has(h.url)) return false;
      seen.add(h.url);
      return true;
    });
    const filtered = merged.filter((h) => domesticKeywords.some((kw) => h.title.includes(kw)));
    return filtered.slice(0, limit);
  }

  const topicId = GOOGLE_NEWS_TOPIC_IDS[key];
  const items = await fetchGoogleNewsRss(topicId ? `https://news.google.com/rss/topics/${topicId}?hl=ko&gl=KR&ceid=KR:ko` : searchUrl);
  // world 카테고리는 이미 구글 자체 편집 큐레이션(토픽)이라 필터가 불필요하고, tech는 좁은 주제
  // 버킷이라 경제/정치 키워드로 거르면 정상 기술 뉴스까지 잘려나간다 — 둘 다 필터 없이 그대로.
  return items.slice(0, limit);
}
