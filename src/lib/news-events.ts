import { db } from "@/lib/db";
import { fetchCandidateHeadlines, type Headline, type NewsCategory } from "@/lib/sources/news-feeds";
import { callMistral, extractJsonArray } from "@/lib/llm-clients";
import { dedupBySimilarTitle } from "@/lib/text-similarity";
import { kstToday } from "@/lib/date";

// 사용자 지정 최종 우선순위: 0=백악관·연준 공식 발표, 1=권력 네트워크·엘리트 그룹 유출/폭로, 2=일반 지정학.
const CATEGORY_PRIORITY: Record<NewsCategory, number> = {
  official: 0,
  "power-network": 1,
  general: 2,
};

export type NewsSeverity = "high" | "medium" | "low";

// 월가 리스크 지수(Fed GPR: Threats/Acts 구분, BlackRock BGRI: 출처·최근성 가중)를 참고해
// "건수"가 아니라 "심각도 × 출처 신뢰도 × 최근성"을 곱한 가중점수로 거부권을 판단한다.
// 심각도 가중치. "normal"은 심각도가 2단계(high/normal)였던 과거 데이터와의 호환용 — 새 분류에서는
// 나오지 않지만, 전환 시점엔 최근 7일 창에 예전 방식으로 저장된 기록이 섞여 있을 수 있어 medium과
// 동일하게 취급한다(7일이 지나면 창에서 자연히 빠짐).
const SEVERITY_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1, normal: 2 };

// 출처 가중치(NewsEvent.priority 기준: 0=백악관·연준, 1=권력 네트워크 유출, 2=일반). BGRI가 브로커리지
// 리포트(전문 소스)에 일반 뉴스보다 더 큰 비중을 두는 것과 같은 원리 — 백악관·연준의 공식 발표가 같은
// 심각도라도 일반 뉴스보다 신뢰도·직접성이 높다고 보고 더 크게 반영한다.
const PRIORITY_WEIGHT: Record<number, number> = { 0: 1.5, 1: 1.2, 2: 1.0 };

/** 발행일로부터 지난 일수에 따른 최근성 감쇠. BGRI가 최근 뉴스에 더 큰 비중을 두는 것과 같은 원리 —
 * 6일 전 소소한 뉴스가 오늘 뉴스와 똑같은 무게로 누적되는 걸 막는다. */
function recencyWeight(daysAgo: number): number {
  if (daysAgo <= 1) return 1.0;
  if (daysAgo <= 4) return 0.7;
  return 0.4;
}

/** 개별 뉴스 항목의 리스크 가중치(심각도 × 출처 × 최근성). */
export function newsItemWeight(item: { priority: number; severity: string; date: Date }, asOf: Date): number {
  const daysAgo = Math.floor((asOf.getTime() - item.date.getTime()) / (1000 * 60 * 60 * 24));
  const severityWeight = SEVERITY_WEIGHT[item.severity] ?? 1;
  const priorityWeight = PRIORITY_WEIGHT[item.priority] ?? 1.0;
  return severityWeight * priorityWeight * recencyWeight(Math.max(0, daysAgo));
}

interface JudgedItem {
  title: string;
  url: string;
  summary: string;
  risky: boolean;
  category: NewsCategory;
  severity: NewsSeverity;
}

/**
 * 원래 Gemini(무료 티어 하루 20건)를 썼으나 메인 리포트 파이프라인과 할당량을 공유해 자주
 * 소진됐다 — Mistral(mistral-large-latest)로 교체. Groq는 분당 토큰 한도(8K~12K TPM)가 낮아
 * 헤드라인 138건(약 4만 자)을 한 번에 못 담아 여러 청크로 쪼개야 했는데, Mistral은 반대로
 * 요청 횟수 제한(분당 2회)이라 토큰 수와 무관하게 138건 전부를 프롬프트 하나에 담아 한 번에
 * 판정할 수 있다(실측: 42,000자 프롬프트가 43초 만에 정상 처리됨) — 청크 분할·대기 로직이
 * 필요 없다.
 */
async function judgeHeadlines(headlines: Headline[]): Promise<JudgedItem[]> {
  if (!process.env.MISTRAL_API_KEY || headlines.length === 0) return [];

  const list = headlines
    .map((h, i) => `${i + 1}. [${h.source}] ${h.title} (${h.url})`)
    .join("\n");

  const prompt = `너는 매크로 자본흐름 분석가다. 아래는 오늘 수집된 뉴스 헤드라인 목록이다.
이 중에서 다음 중 하나에 해당하는 항목만 골라라:
1. "전쟁·무력충돌, 대선/정치 불확실성, 무역분쟁·관세, 연준(Fed)이나 백악관의 시장 방향을 바꿀 정책 발표"에
   해당하며 실제로 자본이 안전자산으로 회피할 만큼 시장을 흔들 수 있는 항목
2. 정계·재계 거물들의 비밀 네트워크·엘리트 결사 유출/폭로처럼, 권력 구조나 정치적 영향력 관계를 드러내는
   탐사보도(예: 정부 고위 인사·억만장자가 연루된 비공개 조직의 회원 명단이 유출된 사건)
일반적인 경제 논평, 이미 알려진 사실 반복, 시장과 무관한 사건은 제외해라.

같은 사건을 다루는 헤드라인이 여러 매체에서 각각 올라온 경우(예: 구글 뉴스가 같은 사건을 여러 언론사
기사로 재수집한 경우, 또는 백악관 공식 발표와 그걸 보도한 언론 기사가 같이 있는 경우) 하나로 묶어서
대표 헤드라인 하나만 골라라 — 나머지 중복은 배열에 포함하지 마라. 대표 선택 기준: ①공식 발표(백악관·
연준 등 원본 소스) 우선, ②그다음 가장 구체적으로 사건을 다루는 헤드라인. 판단이 애매하면 먼저 나온
헤드라인을 대표로 선택해라. 완전히 다른 사건이면(예: 관세 정책과 무력 충돌처럼 주제 자체가 다르면)
중복이 아니니 각각 유지해라.

골라낸 항목마다 심각도(severity)도 함께 매겨라(3단계):
- "high": 이 사건 하나만으로도 시장이 즉시 크게 흔들릴 수준(예: 실제 무력 충돌·전쟁 발발, 국가 디폴트,
  예상 밖 긴급 금리 결정, 주요 은행·금융기관 파산, 정부 붕괴)
- "medium": 명확한 리스크 요인이고 시장이 반응할 만하지만, 이미 진행 중인 사안의 추가 조치·확전 신호
  수준(예: 관세 "인상 발표·시행"처럼 실제 조치, 새로운 제재, 무력 충돌 관련 긴장 고조)
- "low": 리스크 요인이긴 하나 아직 경고·발언·우려 표명 수준이라 단독 영향은 제한적인 경우(정책 발언,
  경고성 언급, 무역분쟁 "우려" 등 — 여러 건이 쌓여야 리스크로 볼 만한 것들)

각 항목에 대해 아래 JSON 배열 형식으로만 답해라. 다른 텍스트는 쓰지 마라:
[{"index": 번호, "summary": "한국어 1문장 요약", "risky": true, "severity": "medium"}]

risky가 아닌 항목은 배열에 아예 포함하지 마라. 해당하는 게 없으면 빈 배열 []만 답해라.

헤드라인 목록:
${list}`;

  const text = await callMistral(prompt, 8192);
  const parsed = extractJsonArray<{ index: number; summary: string; risky: boolean; severity?: string }>(text);
  if (!parsed) return [];

  const judged = parsed
    .filter((p) => p.risky && headlines[p.index - 1])
    .map((p) => ({
      title: headlines[p.index - 1].title,
      url: headlines[p.index - 1].url,
      summary: p.summary,
      risky: true as const,
      category: headlines[p.index - 1].category,
      severity: capScheduledPolicyMeetingSeverity(
        headlines[p.index - 1].title,
        p.severity === "high" || p.severity === "medium" || p.severity === "low" ? p.severity : "medium"
      ),
    }));

  // LLM의 근접중복 병합 지침(위 프롬프트)이 대부분 걸러내지만 temperature>0라 완전히 결정론적이진
  // 않다 — 제목 유사도 기반으로 한 번 더 걸러 대표 1건만 남긴다(news-feeds.ts dedupOfficialHeadlines와
  // 같은 안전망 원리).
  return dedupBySimilarTitle(judged, (j) => j.title);
}

// FOMC·BOJ 통화정책 회의는 날짜가 미리 공개된 정기 일정(major-events.ts FOMC_DATES_2026·
// BOJ_DATES_2026 참고)이라, 사이트의 "high" 정의("예상 밖 긴급" 사건)에 구조적으로 해당하지
// 않는다 — 실제 서프라이즈 여부(반대표 수 등)는 event-outcomes.ts의 fedRateChanged()가 성명서
// 원문을 직접 읽어 별도로(EventOutcome.risky) 정확히 판단한다. Gemini의 severity 판정은
// temperature>0라 완전히 결정론적이지 않아 같은 "FOMC statement 발표" 헤드라인이 실행마다
// medium/high를 오갈 수 있어, 여기서 상한을 강제한다.
const SCHEDULED_POLICY_MEETING_PATTERN = /FOMC|Federal Open Market Committee|Bank of Japan.{0,20}(monetary policy|rate decision)/i;

function capScheduledPolicyMeetingSeverity(title: string, severity: NewsSeverity): NewsSeverity {
  if (severity === "high" && SCHEDULED_POLICY_MEETING_PATTERN.test(title)) return "medium";
  return severity;
}

/**
 * 오늘 뉴스를 모아 리스크 여부를 Gemini로 판정하고, 리스크로 판단된 것만 NewsEvent에 저장한다.
 * 매일 파이프라인에서 한 번만 호출 — page.tsx 같은 실시간 뷰는 DB에서 읽기만 한다(재판정 안 함).
 */
export async function syncNewsEvents(): Promise<{ found: number; errors: string[] }> {
  const errors: string[] = [];
  const { headlines, errors: fetchErrors } = await fetchCandidateHeadlines();
  errors.push(...fetchErrors);

  let judged: JudgedItem[] = [];
  try {
    judged = await judgeHeadlines(headlines);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const today = kstToday();
  for (const item of judged) {
    await db.newsEvent.upsert({
      where: { date_url: { date: new Date(today), url: item.url } },
      create: {
        date: new Date(today), title: item.title, url: item.url, summary: item.summary,
        source: item.category, priority: CATEGORY_PRIORITY[item.category], severity: item.severity,
      },
      // 같은 날 재실행 시(수동 새로고침 등) 우선순위·심각도 분류가 최신 기준으로 갱신되게 한다 —
      // 예전엔 update:{}라 한 번 "judged"로 저장되면 분류 체계가 바뀌어도 그대로 남아있었다.
      update: { source: item.category, priority: CATEGORY_PRIORITY[item.category], severity: item.severity },
    });
  }

  return { found: judged.length, errors };
}

/** 쿼리스트링·트레일링 슬래시를 제거해 같은 기사를 가리키는 URL 변형을 하나로 합친다. */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}

/**
 * 사용자 지정 우선순위(백악관·연준 → 권력 네트워크 유출 → 일반) 순으로, 같은 순위 안에서는 최신순.
 * date+url이 DB 유니크 제약이라 "같은 날 같은 URL" 중복은 이미 막히지만, 구글 뉴스 RSS가 같은
 * 기사를 다음날 이후에도 계속 후보로 올려 매일 재수집·재판정되는 경우 날짜가 다르므로 별도 행으로
 * 쌓인다 — 7일 누적 가중점수에 같은 사건이 여러 번 더해지는 원인. URL 정규화 기준으로 한 번 더
 * dedup해 사건 단위로 한 번만 집계되게 한다(가장 우선순위 높고 최신인 대표 1건만 남김).
 */
export async function getRecentRiskyNews(days: number, asOf: Date = new Date()) {
  const since = new Date(asOf);
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);
  const rows = await db.newsEvent.findMany({
    where: { date: { gte: since, lte: asOf } },
    orderBy: [{ priority: "asc" }, { date: "desc" }],
  });

  const seen = new Set<string>();
  const deduped = [];
  for (const row of rows) {
    const key = normalizeUrl(row.url);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}
