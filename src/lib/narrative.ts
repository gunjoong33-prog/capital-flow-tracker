// 정성적 해설(왜 이런 흐름인지 서술) 생성 — 계산은 전부 scoring/pure.ts가 결정론적으로 하고,
// 여기서는 그 결과를 자연스러운 한국어 문장으로 풀어쓰는 것만 담당한다.
//
// 원래 Gemini 무료 티어를 썼으나 하루 20건 요청 한도가 메인 리포트 파이프라인과 공유돼 자주
// 소진됐다 — Mistral(mistral-large-latest, 무료 Experiment 플랜)로 교체. 실측 비교에서 Groq의
// Llama 3.3 70B는 한국어 응답에 한자·일본어 문자가 섞여 나와 제외했고, Mistral이 이 사이트가
// 쓰는 분석적 한국어 문체를 가장 자연스럽게 생성했다(llm-clients.ts 주석 참고).
import { callMistral } from "@/lib/llm-clients";

export async function generateNarrative(prompt: string, maxOutputTokens = 2048): Promise<string> {
  if (!process.env.MISTRAL_API_KEY) {
    return "[해설 생성 안 됨 — MISTRAL_API_KEY 미설정. 숫자·점수는 위 결과 그대로 신뢰 가능]";
  }
  return callMistral(prompt, maxOutputTokens, 0.4);
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
