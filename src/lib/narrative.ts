// 정성적 해설(왜 이런 흐름인지 서술) 생성 — 계산은 전부 scoring/pure.ts가 결정론적으로 하고,
// 여기서는 그 결과를 자연스러운 한국어 문장으로 풀어쓰는 것만 담당한다.
//
// Google Gemini API 무료 티어 사용 — 카드 등록 없이 무료, 만료 없음(Gemini 2.5/3 Flash 기준
// 하루 250~1500회, 이 프로젝트는 하루 1회+주기별 리포트 몇 번이면 충분해서 유료 전환 필요 없음).
// 발급: https://aistudio.google.com/apikey (구글 계정만 있으면 무료, 카드 불필요)
//
// 나중에 품질이 아쉬우면 다른 공급자로 바꿀 수 있게 이 함수 하나만 바꾸면 되도록 분리해뒀다.

// "-latest" 별칭을 쓰면 구글이 무료 티어 추천 모델을 바꿔도(2.5→3.x 등) 코드 수정 없이 따라간다.
const GEMINI_MODEL = "gemini-flash-latest";

interface GeminiResponse {
  candidates?: {
    content: { parts: { text: string }[] };
  }[];
  error?: { message: string };
}

export async function generateNarrative(prompt: string, maxOutputTokens = 2048): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return "[해설 생성 안 됨 — GEMINI_API_KEY 미설정. 숫자·점수는 위 결과 그대로 신뢰 가능]";
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini 요청 실패: ${res.status} ${errText}`);
  }

  const data = (await res.json()) as GeminiResponse;
  if (data.error) throw new Error(`Gemini 오류: ${data.error.message}`);

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini 응답에 텍스트가 없다");
  return text.trim();
}

/**
 * 오늘의 체크리스트 결과를 해설 프롬프트로 변환.
 * v2 프롬프트 원칙(모르면 모른다고 쓴다, 숫자는 링크로 확인한 값만) 그대로
 * — 해설도 계산된 값 밖의 내용을 지어내지 않도록 명시적으로 지시한다.
 */
export function buildDailyNarrativePrompt(report: {
  step1: unknown;
  step2: unknown;
  step3: unknown;
  step4: unknown;
  step5: unknown;
  step6: unknown;
  step7: unknown;
  step8: unknown;
}): string {
  return `너는 매크로 자본흐름 애널리스트다. 아래는 오늘 계산된 체크리스트 결과(JSON)다.
이 숫자·판정 결과만 근거로 3~5문장짜리 한국어 해설을 써라.
규칙:
- 결과 JSON에 없는 숫자나 사실을 지어내지 마라.
- 결론(매수/지켜보기/현금비중늘리기)이 왜 나왔는지 핵심 근거 1~2개만 짚어라.
- 과장하지 말고 담백하게 써라. 존댓말 아닌 평서체로.

결과 JSON:
${JSON.stringify(report, null, 2)}`;
}
