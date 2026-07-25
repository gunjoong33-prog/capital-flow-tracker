import { db } from "@/lib/db";
import { fetchCandidateHeadlines, type Headline } from "@/lib/sources/news-feeds";

const GEMINI_MODEL = "gemini-flash-latest";

interface JudgedItem {
  title: string;
  url: string;
  summary: string;
  risky: boolean;
}

async function judgeHeadlines(headlines: Headline[]): Promise<JudgedItem[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || headlines.length === 0) return [];

  const list = headlines
    .map((h, i) => `${i + 1}. [${h.source}] ${h.title} (${h.url})`)
    .join("\n");

  const prompt = `너는 매크로 자본흐름 분석가다. 아래는 오늘 수집된 뉴스 헤드라인 목록이다.
이 중에서 "전쟁·무력충돌, 대선/정치 불확실성, 무역분쟁·관세, 연준(Fed)이나 백악관의 시장 방향을 바꿀 정책 발표"에
해당하며 실제로 자본이 안전자산으로 회피할 만큼 시장을 흔들 수 있는 항목만 골라라.
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
      create: { date: new Date(today), title: item.title, url: item.url, summary: item.summary, source: "judged" },
      update: {},
    });
  }

  return { found: judged.length, errors };
}

export async function getRecentRiskyNews(days: number) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);
  return db.newsEvent.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
  });
}
