// Claude API(Anthropic Messages API) 직접 호출 — 원래 Gemini(하루 20건 한도) → Mistral+Groq
// (무료 티어 계정 문제 반복: 2026-09-01 403, 2026-09-04 요청한도 0)를 거쳐 이관했다. 카드 기반
// 표준 종량제라 이런 유형의 계정 사고 이력이 없다. 이 사이트 LLM 작업 9개 전부가 이 함수 하나로
// 통일됐다 — 품질 필요 작업은 claude-sonnet-5, 가벼운 판정·분류는 claude-haiku-4-5-20251001.

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
  // claude-sonnet-5는 temperature 파라미터 자체를 거부한다(2026-09-05 실측:
  // 400 "temperature is deprecated for this model" — haiku-4-5는 정상 수신 확인).
  const temperatureField = model === "claude-sonnet-5" ? {} : { temperature };
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
        ...temperatureField,
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
