// 빅테크 7(Magnificent 7) 개별 종목의 오늘 등락 원인 판정 — news-events.ts의 1단계 리스크 판정과
// 같은 Gemini 인프라(모델·호출 방식)를 재사용하되, 프롬프트와 뉴스 수집 대상은 종목 단위로 새로 만들었다.
// 종목 7개를 한 프롬프트에 묶어 하루 1회만 호출한다(무료 티어 여유를 그대로 유지하기 위함).
import { getMetricHistoryByCount } from "@/lib/metrics";
import { fetchBigTechHeadlines, type Headline } from "@/lib/sources/news-feeds";
import { BIG_TECH_LABELS } from "@/lib/sources/types";

const GEMINI_MODEL = "gemini-flash-latest";

async function change1dFor(ticker: string): Promise<number | null> {
  const history = await getMetricHistoryByCount(ticker, 2);
  if (history.length < 2) return null;
  const [prev, curr] = history;
  return prev.value !== 0 ? ((curr.value - prev.value) / prev.value) * 100 : null;
}

async function judgeBigTechReasons(
  changes: { ticker: string; changePct1d: number | null }[],
  headlinesByTicker: Record<string, Headline[]>
): Promise<Record<string, string>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return {};

  const sections = changes
    .map(({ ticker, changePct1d }) => {
      const label = BIG_TECH_LABELS[ticker] ?? ticker;
      const changeStr = changePct1d !== null ? `${changePct1d >= 0 ? "+" : ""}${changePct1d.toFixed(2)}%` : "확인 못함";
      const heads = headlinesByTicker[ticker] ?? [];
      const list = heads.length > 0 ? heads.map((h, i) => `  ${i + 1}. ${h.title}`).join("\n") : "  (관련 뉴스 없음)";
      return `${ticker}(${label}) 전일 대비 ${changeStr}\n${list}`;
    })
    .join("\n\n");

  const prompt = `너는 주식 시장 분석가다. 아래는 오늘 미국 빅테크 종목들의 전일 대비 등락률과 관련 뉴스 헤드라인이다.
각 종목마다 오늘 등락의 원인을 헤드라인 근거로 한국어 1문장으로 요약해라.
문장은 반드시 존댓말(합쇼체, "~습니다"/"~했습니다"체)로 끝내라 — "~다", "~았다/었다" 같은 평서체는 쓰지 마라.
헤드라인에 등락 원인이 될 만한 내용이 없으면 반드시 "명확한 원인 확인 안 됨"이라고만 써라 — 뉴스에 없는 원인을 지어내지 마라.

각 항목에 대해 아래 JSON 배열 형식으로만 답해라. 다른 텍스트는 쓰지 마라:
[{"ticker": "AAPL", "reason": "한국어 1문장"}]

종목 목록:
${sections}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // gemini-flash-latest가 내부적으로 thinking 모델로 풀려서 추론에 토큰을 얼마나 쓸지가
        // 매 호출마다 들쭉날쭉하다 — maxOutputTokens를 아무리 올려도 thinking이 그 예산을
        // 통째로 먹어버리면 여전히 MAX_TOKENS로 잘린다(news-events.ts에서 겪은 것보다 근본적인
        // 문제). thinkingBudget을 0으로 끄는 건 이 모델이 거부해서(400), 512로 캡을 씌워
        // thinking이 답변 예산을 침범하지 못하게 막는다 — 이 작업은 헤드라인·등락률을 보고
        // 1문장 요약하는 단순 판단이라 깊은 추론이 필요 없다.
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 512 } },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini 빅테크 원인 판정 실패: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as { candidates?: { content: { parts: { text: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return {};

  let parsed: { ticker: string; reason: string }[];
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return {};
  }

  const result: Record<string, string> = {};
  for (const p of parsed) result[p.ticker] = p.reason;
  return result;
}

/**
 * 빅테크 7 등락 원인을 판정해 티커별 한 줄 이유를 반환한다. pipeline.ts·refresh-report.ts에서 호출해
 * runDailyAnalysis()에 넘긴다(run.ts 자체는 DB 읽기만 하도록 LLM 호출과 분리 — news-events.ts와 같은 원칙).
 */
export async function computeBigTechReasons(
  tickers: readonly string[]
): Promise<{ reasons: Record<string, string>; errors: string[] }> {
  const errors: string[] = [];
  const changes = await Promise.all(
    tickers.map(async (ticker) => ({ ticker, changePct1d: await change1dFor(ticker) }))
  );

  const { byTicker, errors: fetchErrors } = await fetchBigTechHeadlines();
  errors.push(...fetchErrors);

  let reasons: Record<string, string> = {};
  try {
    reasons = await judgeBigTechReasons(changes, byTicker);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { reasons, errors };
}
