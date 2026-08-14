// /news 피드가 지금까지 구글 뉴스 하나만 썼는데, 이 사이트가 실제로 매일 수집하는 다른 실데이터
// (FRED 경제지표 발표 결과, FINRA·DART·Dataroma·OpenInsider 기관·내부자 동향)도 "속보"로
// 반영해달라는 요청 대응. LLM으로 요약을 새로 짓지 않고, 파이프라인이 이미 계산한 값(step1
// recentEventOutcomes, step7 institutionalSignals)을 그대로 헤드라인 형태로만 재포장한다 —
// 숫자·문구를 새로 만들지 않는다(데이터 정직성 원칙).
import type { FetchableCategoryKey } from "./sources/news-feeds";
import type { InstitutionalSignals } from "./institutional-signals";

export interface MarketEventHeadline {
  title: string;
  source: string;
  url: string;
  publishedAt: string; // ISO
  category: FetchableCategoryKey;
}

// run.ts의 step7 상세 표가 쓰는 것과 동일한 실제 출처 링크(하드코딩 상수 재선언 — run.ts는 export
// 안 해서 그대로 복제, 값이 바뀌면 두 곳 다 고쳐야 함을 감수).
const FINRA_SHORT_VOLUME_URL = "https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files";
const DART_EQUITY_URL = "https://opendart.fss.or.kr/disclosureinfo/qota/main.do";
const DATAROMA_URL = "https://www.dataroma.com/m/allact.php?typ=a";
const OPENINSIDER_URL = "http://openinsider.com/latest-insider-trading";

/** "헤더줄:\n항목1\n항목2..." 형식(institutional-signals.ts의 summarize* 함수들 공통 포맷)에서
 * 헤더+첫 항목만 한 줄 헤드라인으로 압축한다. "확인 못함"이거나 데이터가 없으면 null. */
function firstLineHeadline(summary: string): string | null {
  if (!summary || summary === "확인 못함") return null;
  const lines = summary.split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  if (lines.length === 1) return lines[0]; // sectorFlowSummary처럼 원래 한 줄인 경우
  return `${lines[0].replace(/:$/, "")} — ${lines[1]}`;
}

/** FOMC는 통화정책 발표라 "중앙은행" 탭, 나머지(CPI/PPI/PCE/NFP)는 "경제 발표" 탭으로 분류. */
function categoryForEvent(name: string): FetchableCategoryKey {
  return name.includes("FOMC") ? "central-bank" : "econ-release";
}

/**
 * step1.recentEventOutcomes 중 오늘(KST) 실제로 발표된 것만 골라 헤드라인으로 만든다 — 이
 * 배열은 최근 5일 창을 매일 다시 훑으므로, 필터 없이 다 넣으면 같은 발표가 5일 내내 "오늘의
 * 속보"로 반복 노출된다.
 */
export function buildEventOutcomeHeadlines(
  recentEventOutcomes: { name: string; date: string; detail: string; subLabel?: string }[],
  todayStr: string
): MarketEventHeadline[] {
  return recentEventOutcomes
    .filter((o) => o.date === todayStr)
    .map((o) => ({
      title: `${o.name}${o.subLabel ?? ""} 실제 결과 — ${o.detail}`,
      source: "FRED(연준 경제데이터)",
      url: `/calendar/${o.date}`,
      publishedAt: new Date(`${o.date}T00:00:00.000Z`).toISOString(),
      category: categoryForEvent(o.name),
    }));
}

/** step7 기관·내부자 신호를 헤드라인으로 재포장 — 매일 새로 계산되는 "오늘자 스냅샷"이라 필터 없이
 * 그날 하루치만 반영(다음날엔 그날 값으로 자연 교체됨, pipeline.ts가 매일 해당 날짜를 delete 후
 * 재생성하므로 누적되지 않는다). */
export function buildInstitutionalHeadlines(signals: InstitutionalSignals, asOf: Date): MarketEventHeadline[] {
  const publishedAt = asOf.toISOString();
  const todayFrag = publishedAt.slice(0, 10);

  // slug: url 뒤에 붙여 (date,category,url) 유니크 제약을 만족시킨다. Dataroma를 baseUrl로 쓰는
  // 항목이 3개(슈퍼투자자·컨센서스·자금흐름)라 todayFrag만 붙이면 셋 다 같은 url이 돼 createMany의
  // skipDuplicates가 둘을 조용히 버리는 버그가 실제로 났다(실측 확인) — 항목별 고유 slug 필수.
  const candidates: { summary: string; source: string; baseUrl: string; slug: string; category: FetchableCategoryKey }[] = [
    { summary: signals.shortVolumeSummary, source: "FINRA", baseUrl: FINRA_SHORT_VOLUME_URL, slug: "short-volume", category: "stock" },
    { summary: signals.domesticFilingSummary, source: "DART(전자공시)", baseUrl: DART_EQUITY_URL, slug: "filings", category: "stock" },
    { summary: signals.superInvestorSummary, source: "Dataroma(슈퍼투자자)", baseUrl: DATAROMA_URL, slug: "super-investor", category: "stock" },
    { summary: signals.stockConsensusSummary, source: "Dataroma(컨센서스)", baseUrl: DATAROMA_URL, slug: "consensus", category: "stock" },
    { summary: signals.insiderTradeSummary, source: "OpenInsider", baseUrl: OPENINSIDER_URL, slug: "insider", category: "stock" },
    { summary: signals.sectorFlowSummary, source: "Dataroma·OpenInsider(자금흐름)", baseUrl: DATAROMA_URL, slug: "sector-flow", category: "stock" },
  ];

  return candidates
    .map((c) => ({ ...c, title: firstLineHeadline(c.summary) }))
    .filter((c): c is typeof c & { title: string } => c.title !== null)
    .map((c) => ({
      title: c.title,
      source: c.source,
      url: `${c.baseUrl}#${todayFrag}-${c.slug}`,
      publishedAt,
      category: c.category,
    }));
}
