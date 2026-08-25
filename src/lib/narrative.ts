// 정성적 해설(왜 이런 흐름인지 서술) 생성 — 계산은 전부 scoring/pure.ts가 결정론적으로 하고,
// 여기서는 그 결과를 자연스러운 한국어 문장으로 풀어쓰는 것만 담당한다.
//
// 원래 Gemini 무료 티어를 썼으나 하루 20건 요청 한도가 메인 리포트 파이프라인과 공유돼 자주
// 소진됐다 — Mistral(mistral-large-latest, 무료 Experiment 플랜)로 교체. 실측 비교에서 Groq의
// Llama 3.3 70B는 한국어 응답에 한자·일본어 문자가 섞여 나와 제외했고, Mistral이 이 사이트가
// 쓰는 분석적 한국어 문체를 가장 자연스럽게 생성했다(llm-clients.ts 주석 참고).
import { callMistral, sleep } from "@/lib/llm-clients";
import { fetchRecentLearningContext } from "@/lib/narrative-learning-context";

/**
 * 생성한 해설을 스스로 재검토해 어려운 문장이면 한 번만 다시 쓴다(무한루프 방지로 1회 제한).
 * "비전공자가 읽어도 명쾌해야 한다"는 요구를 생성 프롬프트 지시만으로는 못 지키는 날이 있어서
 * (LLM이 지시를 놓치는 경우) 별도 검수 패스를 둔다 — narrative.ts 자체가 서술 레이어라 안전.
 */
async function selfReviewForPlainLanguage(narrative: string, maxOutputTokens: number): Promise<string> {
  const reviewPrompt = `아래 글을 비전공자가 한 번 읽고 바로 이해할 수 있는지 검토해라.
전문용어를 괄호로 풀이하는 방식이 아니라, 문장 구조 자체를 쉽게 바꿔야 한다.
이미 충분히 쉬우면 그대로 반환하고, 어려운 부분이 있으면 그 부분만 쉬운 문장으로 다시 써서
전체 글을 반환해라. 다른 설명 없이 최종 글만 출력해라.

원문:
${narrative}`;
  try {
    const reviewed = await callMistral(reviewPrompt, maxOutputTokens, 0.3);
    return reviewed.trim().length > 0 ? reviewed : narrative;
  } catch {
    return narrative; // 검수 실패해도 원문은 이미 있으니 그대로 쓴다(자가검수는 개선 시도일 뿐, 필수 경로 아님).
  }
}

export async function generateNarrative(prompt: string, maxOutputTokens = 2048): Promise<string> {
  if (!process.env.MISTRAL_API_KEY) {
    return "[해설 생성 안 됨 — MISTRAL_API_KEY 미설정. 숫자·점수는 위 결과 그대로 신뢰 가능]";
  }

  // buildDailyNarrativePrompt는 learningContext 파라미터를 받지만, 유일한 실제 호출부인
  // pipeline.ts:351(보호 파일 — 이 브랜치에서 절대 수정 안 함)은 그 파라미터를 안 넘긴다.
  // pipeline.ts를 안 건드리면서 LearningNote를 실제로 써먹으려면, generateNarrative가 이미
  // 받은 prompt 문자열에 직접 참고자료를 덧붙이는 수밖에 없다 — 이러면 4개 호출부(pipeline.ts·
  // comprehensive-report.ts·period-report.ts·debug/mistral) 전부에 자동 적용된다.
  // DB 조회 실패는 "학습 컨텍스트 없이 진행"으로 조용히 넘어간다 — pipeline.ts가 이 함수 전체를
  // try/catch로 감싸고 있어서(narrative = "[해설 생성 실패]"), 여기서 던지면 학습 컨텍스트 하나
  // 때문에 해설 전체가 날아간다.
  let learningContext: string | undefined;
  try {
    learningContext = await fetchRecentLearningContext();
  } catch {
    learningContext = undefined;
  }
  const fullPrompt = learningContext ? `${prompt}\n\n참고(축적된 전문가 해석 방법론):\n${learningContext}` : prompt;

  const draft = await callMistral(fullPrompt, maxOutputTokens, 0.4);
  // 자가검수 패스가 연달아 두 번째 Mistral 호출을 만든다 — 이 코드베이스의 기존 관례
  // (pipeline.ts:356, llm-clients.ts 주석)대로 무료 티어 레이트리밋을 지키려면 연속 호출
  // 사이에 간격을 둬야 한다(최종 리뷰 지적: generateNarrative 호출부가 4곳이라 이 간격
  // 없이는 Mistral 호출량이 그냥 2배가 된다).
  await sleep(20_000);
  return selfReviewForPlainLanguage(draft, maxOutputTokens);
}

/**
 * 오늘의 체크리스트 결과를 해설 프롬프트로 변환.
 * v2 프롬프트 원칙(모르면 모른다고 쓴다, 숫자는 링크로 확인한 값만) 그대로
 * — 해설도 계산된 값 밖의 내용을 지어내지 않도록 명시적으로 지시한다.
 *
 * 사용자 요구(2026-08-25 자기학습 프로젝트): "지표가 이래서 이랬다" 식 나열이 아니라
 * 원인→결과→향후 자금흐름 전망의 인과관계로, 비전공자가 읽어도 명쾌한 쉬운 문장으로 쓴다.
 * learningContext(선택)는 LearningNote에서 distill된 전문가 해석 방법론 — 있으면 프롬프트에 참고자료로 얹는다.
 */
export function buildDailyNarrativePrompt(
  report: {
    step1: unknown;
    step2: unknown;
    step3: unknown;
    step4: unknown;
    step5: unknown;
    step6: unknown;
    step7: unknown;
    step8: unknown;
  },
  learningContext?: string
): string {
  return `너는 매크로 자본흐름 애널리스트다. 아래는 오늘 계산된 체크리스트 결과(JSON)다.
이 숫자·판정 결과만 근거로 3~5문장짜리 한국어 해설을 써라.

규칙:
- 결과 JSON에 없는 숫자나 사실을 지어내지 마라.
- "지표가 이래서 이랬다" 식 나열이 아니라, 원인 → 결과 → 향후 자금 흐름 전망의 인과관계로 써라.
  ("어떤 지표가 원인이 되어 이런 변화가 있었고, 앞으로 자금이 어디로 흘러갈 것으로 보인다"는 구조)
- 결론(매수/지켜보기/현금비중늘리기)이 왜 나왔는지 핵심 근거 1~2개만 짚어라.
- 비전공자가 한 번 읽고 바로 이해할 수 있도록 쉬운 문장으로 써라. 전문용어를 괄호로 풀이하지 말고,
  문장 구조 자체를 쉽게 써라.
- 과장하지 말고 담백하게 써라. 존댓말 아닌 평서체로.
${learningContext ? `\n참고(전문가 해석 방법론):\n${learningContext}\n` : ""}
결과 JSON:
${JSON.stringify(report, null, 2)}`;
}
