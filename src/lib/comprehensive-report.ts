// 1단계 카드 위 "보고서" 버튼이 보여주는 종합 해설 — narrative.ts의 3~5문장 요약과 달리,
// 경제학·투자 초심자도 이해할 수 있는 수준으로 1~8단계 인과관계를 문단별로 풀어쓴 긴 글이다.
// 계산은 전부 scoring/pure.ts가 결정론적으로 하고, 여기서는 그 결과를 근거로 서술만 생성한다.
import { generateNarrative } from "@/lib/narrative";
import { WEIGHTS, TOTAL_WEIGHT } from "@/lib/scoring/pure";

// gemini-flash-latest는 내부적으로 thinking 모델로 풀려 추론에 토큰을 많이 쓴다(narrative.ts와 같은 문제).
// 4문단 + 마지막 요약 문장을 다 채우려면 2048로는 부족해서 넉넉히 잡는다.
const MAX_OUTPUT_TOKENS = 8192;

// report.details 안의 결정론적 요약 문장(예: step7Summary)들은 StepCard UI("6단계" 카드 안)에서
// 보여줄 목적으로 이미 "N단계"라는 표현을 그대로 박아서 만들어졌다(run.ts summarizeStep7 등) —
// 그 문장을 그대로 JSON에 실어 보내면 "본문에 단계 번호 쓰지 마라"고 아무리 프롬프트로 지시해도
// LLM이 원문을 충실히 인용하다가 번호까지 같이 베껴온다(실제 확인 — "6단계와는 다른 흐름"이 그대로
// 종합 보고서에 나타난 사례). 프롬프트 지시로 막으려 하지 않고, LLM이 보는 JSON 자체에서 번호를
// 미리 지워 원천 차단한다.
const STEP_NUMBER_LABELS: Record<string, string> = {
  "1단계": "뉴스 리스크",
  "2단계": "유동성",
  "3단계": "캐리 트레이드",
  "4단계": "환율·금·유가",
  "5단계": "자금 도착",
  "6단계": "섹터",
  "7단계": "기관 매집·심리 지표",
  "8단계": "최종 점수",
};

function stripStepNumbers(value: unknown): unknown {
  if (typeof value === "string") {
    let result = value;
    for (const [pattern, label] of Object.entries(STEP_NUMBER_LABELS)) {
      result = result.split(pattern).join(label);
    }
    return result;
  }
  if (Array.isArray(value)) return value.map(stripStepNumbers);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripStepNumbers(v)]));
  }
  return value;
}

export function buildComprehensiveReportPrompt(report: {
  step1: unknown;
  step2: unknown;
  step3: unknown;
  step4: unknown;
  step5: unknown;
  step6: unknown;
  step7: unknown;
  step8: unknown;
  details: unknown;
}): string {
  return `너는 매크로 자본흐름을 매일 직접 챙겨보는 개인 투자자이고, 지금부터 쓰는 글은 자기 자신에게
존댓말로 보고하는 브리핑이다(반말로 쓰는 사적인 일기가 아니다). 아래는 오늘 계산된 체크리스트
결과(JSON)다. 이 결과만 근거로 오늘 하루를 정리해라.

*** 문체 규칙(가장 중요, 다른 모든 규칙보다 우선) ***
출력하는 모든 문장은 예외 없이 "~습니다/~입니다/~합니다/~했습니다/~겠습니다" 같은 존댓말(합니다체)
로 끝나야 한다. "~다/~였다/~한다/~하다/~겠다"처럼 "다"로 끝나는 평서체 문장은 단 하나도 섞이면
안 된다. 예를 들어 "숨 쉴 틈 없는 하루였다"가 아니라 "숨 쉴 틈 없는 하루였습니다"라고 써야 한다.
글을 다 쓴 뒤 스스로 마지막 글자가 전부 "다" 계열이 아니라 "-습니다/-입니다"류인지 검토해라.

원칙
- 결과 JSON에 없는 숫자나 사실을 지어내지 마라. 근거가 없으면 "확인 안 됨"이라고 써라.
- 오늘 최종 투자 적합도 점수(숫자)를 언급할 때는 절대 네가 직접 숫자를 옮겨 적지 마라 — 반드시
  {{FINAL_SCORE}}라는 문자열 그대로 써라(예: "최종 점수는 {{FINAL_SCORE}}점으로"). 최종 결론
  (매수/지켜보기/현금비중늘리기)을 언급할 때도 마찬가지로 반드시 {{FINAL_DECISION}} 그대로 써라.
  둘 다 나중에 정확한 값으로 기계적으로 치환된다 — 직접 숫자를 타이핑하면 오타가 나도 못 잡는다.
- 매일 읽는 자기 자신을 위한 글이니 전문용어를 매번 괄호로 풀어 설명하지 마라 — 이미 알고 있다고 가정해라.
- 본문 어디에도 "1단계", "2단계"처럼 단계 번호를 그대로 언급하지 마라. "뉴스 리스크", "유동성",
  "캐리 트레이드", "환율·금·유가", "자금 도착", "섹터", "기관 매집·심리 지표", "최종 점수"처럼
  실제 내용으로 풀어서 불러라.
- "~로 인해", "~것으로 확인되었습니다", "이러한 ~는" 같은 딱딱한 보고서 말투를 반복하지 말고
  자연스러운 문장으로 써라. 문장 시작을 매번 "1단계에서는", "2단계 점수는"처럼 기계적으로
  열거하지 마라.
- 문장은 자연스럽게 이어 쓰고, 마침표마다 줄바꿈하지 마라 — 문단 단위로 흐르게 써라.
- 정해진 소제목이나 고정된 문단 개수를 강요하지 마라. 그날 특별할 게 없는 단계는 한두 문장으로 짧게
  넘어가고, 눈에 띄는 부분에 분량을 더 써라. 매일 같은 분량·같은 순서로 기계적으로 채우지 마라.

다뤄야 할 내용(이 순서로 자연스럽게 녹여 써라)
1. 오늘 시장 환경이 전반적으로 어땠는지.
2. 1단계(뉴스 리스크·거부권)와 2단계(유동성)가 3·4단계(캐리 트레이드, 환율·금·유가)에 어떤 영향을
   줬을지 JSON 근거로만 개연성 있게 연결.
3. 자본이 어디로 움직였는지가 실제 자금이 도착한 섹터, 기관 매집·심리 지표와 맞아떨어지는지 어긋나는지
   ("6단계", "7단계"라고 쓰지 말고 "실제 도착한 섹터", "기관 자금" 처럼 풀어서 불러라).
4. 8단계 최종 점수가 어떻게 나왔는지 — 곱셈 과정을 매번 전부 나열하지 말고, 오늘 점수를 가장 크게
   끌어올리거나 끌어내린 요인 한두 가지만 짚어라(가중치는 2단계×${WEIGHTS.step2}, 3단계×${WEIGHTS.step3},
   4단계×${WEIGHTS.step4}, 5단계×${WEIGHTS.step5}, 6단계×${WEIGHTS.step6}, 합계 ${TOTAL_WEIGHT}로 나눈
   값이니 필요할 때만 참고). 1단계 거부권으로 결론이 한 단계 낮아졌으면 그것도 짚어라.
5. 마지막으로 오늘 결론(매수/지켜보기/현금비중늘리기)에 비춰 지금 어떻게 대응하면 좋을지. 매일 같은
   문장으로 끝내지 말고 그날 상황에 맞는 표현으로 마무리해라.

반드시 언급해야 하는 것 — JSON 안에 아래 유형의 항목이 하나라도 있으면 절대 생략하지 말고 그 사실과
이유를 최소 한 문장으로 짚어라(이런 항목은 코드가 "오늘은 평소와 다르게 판단했다"고 표시해둔
신호라서, 통상적인 요약보다 우선순위가 높다). 이 항목들을 언급할 때도 위 "1단계·2단계 번호를
그대로 언급하지 마라" 원칙은 그대로 적용된다 — "3단계 하드캡" 대신 "엔화 변동성 급등으로
하드캡을 걸었다"처럼 번호 없이 내용으로 풀어써라:
- 각 단계 결과의 note/warning 필드에 "조정", "하향", "경계", "우선한다"처럼 통상적인 판정을 코드가
  의도적으로 뒤집거나 깎았다는 문구가 있는 경우(예: 4단계 텀프리미엄 급등으로 점수를 절반으로 낮춘
  경우, 3단계 엔화 변동성 급등으로 하드캡을 건 경우).
- details.step2Aux/step4Aux 안에 met:false이면서 value나 criterion에 "경계", "스티프닝", "이상"처럼
  평소와 다르다고 표시된 보조 지표가 있는 경우(예: 2Y-10Y 스프레드가 양수인데도 30년물 급등 때문에
  met:false로 뒤집힌 경우 — 부호만 보면 정상 같지만 실제로는 경계 신호라는 걸 짚어야 한다).

(위 번호와 "1단계·2단계" 같은 표기는 네가 순서를 놓치지 않게 하려고 적어둔 것일 뿐, 실제
글에는 절대 그대로 옮기지 마라 — 위 원칙대로 내용으로 풀어서 써라.)

마지막으로 다시 한번: 아래 JSON을 근거로 글을 쓰되, 모든 문장을 "~습니다/~입니다"로 끝내라.
"~다"로 끝나는 문장은 절대 안 된다.

결과 JSON:
${JSON.stringify(stripStepNumbers(report), null, 2)}`;
}

export async function generateComprehensiveReport(report: Parameters<typeof buildComprehensiveReportPrompt>[0]): Promise<string> {
  const text = await generateNarrative(buildComprehensiveReportPrompt(report), MAX_OUTPUT_TOKENS);

  // LLM이 JSON에 있는 숫자를 그대로 옮겨 적다가도 가끔 틀린다(외부 감사 지적, 실제 확인 — 실제
  // macroTrendScore 2.901을 "3.35"로 잘못 서술한 사례) — 가장 중요한 두 값(최종 점수·최종 결론)만은
  // LLM이 직접 쓰지 않고 플레이스홀더 토큰으로 남기게 한 뒤 여기서 기계적으로 정확한 값을 채운다.
  const step8 = report.step8 as { macroTrendScore?: number; finalDecision?: string } | undefined;
  if (!step8 || typeof step8.macroTrendScore !== "number" || !step8.finalDecision) return text;

  const hadScorePlaceholder = text.includes("{{FINAL_SCORE}}");
  const hadDecisionPlaceholder = text.includes("{{FINAL_DECISION}}");
  if (!hadScorePlaceholder || !hadDecisionPlaceholder) {
    console.error(
      `generateComprehensiveReport: LLM이 플레이스홀더 토큰을 안 지켰다(score=${hadScorePlaceholder}, decision=${hadDecisionPlaceholder}) — 숫자 오기 가능성, 원문 확인 필요`
    );
  }

  return text
    .replaceAll("{{FINAL_SCORE}}", step8.macroTrendScore.toFixed(2))
    .replaceAll("{{FINAL_DECISION}}", step8.finalDecision);
}
