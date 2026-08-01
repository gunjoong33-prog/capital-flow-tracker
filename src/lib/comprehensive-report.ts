// 1단계 카드 위 "보고서" 버튼이 보여주는 종합 해설 — narrative.ts의 3~5문장 요약과 달리,
// 경제학·투자 초심자도 이해할 수 있는 수준으로 1~8단계 인과관계를 문단별로 풀어쓴 긴 글이다.
// 계산은 전부 scoring/pure.ts가 결정론적으로 하고, 여기서는 그 결과를 근거로 서술만 생성한다.
import { generateNarrative } from "@/lib/narrative";
import { WEIGHTS, TOTAL_WEIGHT } from "@/lib/scoring/pure";

// gemini-flash-latest는 내부적으로 thinking 모델로 풀려 추론에 토큰을 많이 쓴다(narrative.ts와 같은 문제).
// 4문단 + 마지막 요약 문장을 다 채우려면 2048로는 부족해서 넉넉히 잡는다.
const MAX_OUTPUT_TOKENS = 8192;

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
  return `너는 매크로 자본흐름을 매일 직접 챙겨보는 개인 투자자다. 아래는 오늘 계산된 체크리스트 결과(JSON)다.
이 결과만 근거로, 자기 자신을 위해 쓰는 투자 일지처럼 오늘 하루를 정리해라.

원칙
- 결과 JSON에 없는 숫자나 사실을 지어내지 마라. 근거가 없으면 "확인 안 됨"이라고 써라.
- 매일 읽는 자기 자신을 위한 글이니 전문용어를 매번 괄호로 풀어 설명하지 마라 — 이미 알고 있다고 가정해라.
- 존댓말(합니다체)로 담백하게 쓰되, "~로 인해", "~것으로 확인되었습니다", "이러한 ~는" 같은 딱딱한 보고서
  말투를 반복하지 말고 자연스러운 문장으로 써라. 문장 시작을 매번 "1단계에서는", "2단계 점수는"처럼
  기계적으로 열거하지 마라.
- 문장은 자연스럽게 이어 쓰고, 마침표마다 줄바꿈하지 마라 — 문단 단위로 흐르게 써라.
- 정해진 소제목이나 고정된 문단 개수를 강요하지 마라. 그날 특별할 게 없는 단계는 한두 문장으로 짧게
  넘어가고, 눈에 띄는 부분에 분량을 더 써라. 매일 같은 분량·같은 순서로 기계적으로 채우지 마라.

다뤄야 할 내용(이 순서로 자연스럽게 녹여 써라)
1. 오늘 시장 환경이 전반적으로 어땠는지.
2. 1단계(뉴스 리스크·거부권)와 2단계(유동성)가 3·4단계(캐리 트레이드, 환율·금·유가)에 어떤 영향을
   줬을지 JSON 근거로만 개연성 있게 연결.
3. 5단계(자본이 어디로 움직였는지)가 6·7단계(실제 도착한 섹터, 기관 매집·심리 지표)와 맞아떨어지는지
   어긋나는지.
4. 8단계 최종 점수가 어떻게 나왔는지 — 곱셈 과정을 매번 전부 나열하지 말고, 오늘 점수를 가장 크게
   끌어올리거나 끌어내린 요인 한두 가지만 짚어라(가중치는 2단계×${WEIGHTS.step2}, 3단계×${WEIGHTS.step3},
   4단계×${WEIGHTS.step4}, 5단계×${WEIGHTS.step5}, 6단계×${WEIGHTS.step6}, 합계 ${TOTAL_WEIGHT}로 나눈
   값이니 필요할 때만 참고). 1단계 거부권으로 결론이 한 단계 낮아졌으면 그것도 짚어라.
5. 마지막으로 오늘 결론(매수/지켜보기/현금비중늘리기)에 비춰 지금 어떻게 대응하면 좋을지. 매일 같은
   문장으로 끝내지 말고 그날 상황에 맞는 표현으로 마무리해라.

결과 JSON:
${JSON.stringify(report, null, 2)}`;
}

export async function generateComprehensiveReport(report: Parameters<typeof buildComprehensiveReportPrompt>[0]): Promise<string> {
  return generateNarrative(buildComprehensiveReportPrompt(report), MAX_OUTPUT_TOKENS);
}
