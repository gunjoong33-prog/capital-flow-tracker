import { db } from "@/lib/db";
import { fetchCandidateHeadlines, type Headline, type NewsCategory } from "@/lib/sources/news-feeds";

const GEMINI_MODEL = "gemini-flash-latest";

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

async function judgeHeadlines(headlines: Headline[]): Promise<JudgedItem[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || headlines.length === 0) return [];

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

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // gemini-flash-latest가 내부적으로 thinking 모델로 풀려서 추론에 토큰을 많이 쓴다 —
        // 헤드라인 10여 개를 판정하기엔 1024로 부족해서 MAX_TOKENS로 잘렸었다(narrative.ts와 같은 문제).
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini 뉴스 판정 실패: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as { candidates?: { content: { parts: { text: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let parsed: { index: number; summary: string; risky: boolean; severity?: string }[];
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  return parsed
    .filter((p) => p.risky && headlines[p.index - 1])
    .map((p) => ({
      title: headlines[p.index - 1].title,
      url: headlines[p.index - 1].url,
      summary: p.summary,
      risky: true,
      category: headlines[p.index - 1].category,
      severity: p.severity === "high" || p.severity === "medium" || p.severity === "low" ? p.severity : "medium",
    }));
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

  const today = new Date().toISOString().slice(0, 10);
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

/** 사용자 지정 우선순위(백악관·연준 → 권력 네트워크 유출 → 일반) 순으로, 같은 순위 안에서는 최신순. */
export async function getRecentRiskyNews(days: number) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);
  return db.newsEvent.findMany({
    where: { date: { gte: since } },
    orderBy: [{ priority: "asc" }, { date: "desc" }],
  });
}
