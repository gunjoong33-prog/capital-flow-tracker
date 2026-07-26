import { db } from "@/lib/db";
import { fetchCandidateHeadlines, type Headline, type NewsCategory } from "@/lib/sources/news-feeds";

const GEMINI_MODEL = "gemini-flash-latest";

// 사용자 지정 최종 우선순위: 0=백악관·연준 공식 발표, 1=권력 네트워크·엘리트 그룹 유출/폭로, 2=일반 지정학.
const CATEGORY_PRIORITY: Record<NewsCategory, number> = {
  official: 0,
  "power-network": 1,
  general: 2,
};

interface JudgedItem {
  title: string;
  url: string;
  summary: string;
  risky: boolean;
  category: NewsCategory;
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

각 항목에 대해 아래 JSON 배열 형식으로만 답해라. 다른 텍스트는 쓰지 마라:
[{"index": 번호, "summary": "한국어 1문장 요약", "risky": true}]

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

  let parsed: { index: number; summary: string; risky: boolean }[];
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
        source: item.category, priority: CATEGORY_PRIORITY[item.category],
      },
      // 같은 날 재실행 시(수동 새로고침 등) 우선순위 분류가 최신 기준으로 갱신되게 한다 —
      // 예전엔 update:{}라 한 번 "judged"로 저장되면 분류 체계가 바뀌어도 그대로 남아있었다.
      update: { source: item.category, priority: CATEGORY_PRIORITY[item.category] },
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
