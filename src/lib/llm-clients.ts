// Gemini 무료 티어(하루 20건, generativelanguage.googleapis.com/generate_content_free_tier_requests)
// 한도 문제로 대체 — 실측 비교 결과 Llama 3.3 70B(Groq)는 한국어 응답에 한자·일본어 문자가 섞여
// 나와 제외했고, 아래 두 제공자만 검증을 통과했다. 성격이 달라 용도별로 나눠 쓴다:
// - Mistral(원래 mistral-large-latest — 한국어 품질이 가장 좋았음): 품질이 중요하고 호출 빈도가
//   낮거나(narrative.ts) 청크 사이 대기가 가능한 배치 작업(news-events.ts)에 쓴다. 2026-09-01부터
//   계정 결제수단 미등록으로 large 모델이 막혀 mistral-small-latest로 임시 강등(아래 callMistral
//   주석 참고) — 결제수단 등록되면 원복 검토.
// - Groq(gpt-oss-120b 등): 속도가 빠르고 분당 요청 수 여유가 있어, 가볍고 빈도 낮은 판정
//   (bigtech-reasons.ts, news-feeds.ts)에 쓴다.
// 둘 다 OpenAI 호환 chat/completions 포맷이라 클라이언트를 하나로 통일해뒀다.

interface ChatCompletionResponse {
  choices?: { message: { content: string } }[];
}

/** 429 응답에서 재시도 대기시간(초)을 뽑는다 — Retry-After 헤더 우선, 없으면 에러 메시지에
 * 박힌 "try again in 7.56s" 문구를 파싱한다. 둘 다 없으면 fallback초를 기본값으로 쓴다. */
function parseRetryAfterSeconds(res: Response, bodyText: string, fallback: number): number {
  const header = res.headers.get("retry-after");
  if (header) {
    const n = Number(header);
    if (!Number.isNaN(n)) return n;
  }
  const m = bodyText.match(/try again in ([\d.]+)s/);
  return m ? Number(m[1]) : fallback;
}

export async function callMistral(prompt: string, maxTokens = 2048, temperature = 0.2): Promise<string> {
  const request = () =>
    fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.MISTRAL_API_KEY}` },
      body: JSON.stringify({
        // 2026-09-01: 계정이 결제수단 미등록 상태로 "무료" 플랜 재편되며 mistral-large-latest가
        // 키와 무관하게 403 tier_not_allowed로 막힘(직접 확인). 결제수단 등록 전까지 임시로
        // mistral-small-latest 사용 — 사용자가 결제수단 등록하면 원복 검토.
        model: "mistral-small-latest",
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: maxTokens,
      }),
    });

  let res = await request();
  // 무료 티어가 분당 2회로 빡빡해서 pipeline.ts가 호출 사이에 고정 대기(sleep)를 두지만, 그 여유폭
  // 안에서도 실제로 429가 뜨는 경우가 있었다 — Groq처럼 서버가 알려준 정확한 대기시간만큼 기다렸다가
  // 한 번 재시도한다(고정 대기만 믿고 재시도 로직이 없었던 것이 외부 감사 지적 사항).
  if (res.status === 429) {
    const waitSec = Math.min(parseRetryAfterSeconds(res, await res.text(), 20), 60);
    await sleep(Math.ceil(waitSec * 1000) + 500);
    res = await request();
  }
  if (!res.ok) throw new Error(`Mistral 요청 실패: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as ChatCompletionResponse;
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Mistral 응답에 텍스트가 없다");
  return text.trim();
}

export async function callGroq(
  prompt: string,
  options: {
    model?: string;
    maxTokens?: number;
    reasoningEffort?: "none" | "low" | "medium" | "high" | "default";
  } = {}
): Promise<string> {
  const { model = "openai/gpt-oss-120b", maxTokens = 2048, reasoningEffort } = options;
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: maxTokens,
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  const request = () =>
    fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify(body),
    });

  let res = await request();
  // 분당 토큰 한도(TPM)는 롤링 윈도우라, 짧은 시간에 여러 건을 연달아 호출하면(예: bigtech-reasons.ts가
  // 종목 7개를 순차 호출) 한 번 대기해도 그 사이 다른 호출이 쓴 토큰 때문에 재시도가 또 429에 걸릴 수
  // 있다(실측: 7건 중 1건이 1차 재시도 후에도 또 걸림) — 최대 3번까지, 매번 Groq가 알려주는 정확한
  // 대기시간만큼만 기다렸다가 재시도한다(무한 재시도는 안 하고, 그래도 실패하면 진짜 에러로 처리).
  for (let attempt = 0; attempt < 3 && res.status === 429; attempt++) {
    const waitSec = Math.min(parseRetryAfterSeconds(res, await res.text(), 5), 30);
    await sleep(Math.ceil(waitSec * 1000) + 500);
    res = await request();
  }
  if (!res.ok) throw new Error(`Groq 요청 실패: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as ChatCompletionResponse;
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq 응답에 텍스트가 없다");
  return text.trim();
}

interface ClaudeResponse {
  content?: { type: string; text: string }[];
}

/** Anthropic Messages API 직접 호출(SDK 없이 원시 fetch, Mistral/Groq와 같은 스타일).
 * 2026-09-04: Mistral 계정이 x-ratelimit-limit-req-minute: 0으로 막히고 Groq도 이 사이트의
 * 22K토큰짜리 종합보고서 프롬프트가 무료 티어 TPM(8000)을 넘어 대체 불가해, 이 사이트 LLM
 * 작업 전체를 여기로 이관한다(llm-clients.ts 상단 주석 참고). model은 호출부가 항상 명시적으로
 * 넘긴다 — 기본값을 두면 "이 작업에 어느 모델을 쓰는지"가 함수 내부에 숨어버린다. */
export async function callClaude(
  prompt: string,
  options: { model: string; maxTokens?: number; temperature?: number }
): Promise<string> {
  const { model, maxTokens = 2048, temperature = 0.2 } = options;
  const request = () =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: "user", content: prompt }],
      }),
    });

  let res = await request();
  // Claude 표준 티어(Start 기준)는 분당 1,000요청·입력 200만 토큰로 이 사이트 하루 물량보다
  // 압도적으로 여유로워(공식 문서 확인) Groq처럼 재시도 중에도 또 걸리는 문제는 예상하지 않는다
  // — Mistral과 같은 1회 재시도 패턴으로 시작하고, 실제로 반복되면 그때 늘린다(YAGNI).
  if (res.status === 429) {
    const waitSec = Math.min(parseRetryAfterSeconds(res, await res.text(), 20), 60);
    await sleep(Math.ceil(waitSec * 1000) + 500);
    res = await request();
  }
  if (!res.ok) throw new Error(`Claude 요청 실패: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as ClaudeResponse;
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Claude 응답에 텍스트가 없다");
  return text.trim();
}

/** LLM 응답에서 JSON 배열만 뽑아 파싱한다(마크다운 코드펜스로 감싸 나오는 경우까지 대응). */
export function extractJsonArray<T>(text: string): T[] | null {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

/** Mistral 무료 티어(분당 2회) 같은 낮은 RPM 한도를 지킬 때 청크 사이에 넣는 대기. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
