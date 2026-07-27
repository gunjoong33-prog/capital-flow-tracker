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
  return `너는 매크로 자본흐름을 알기 쉽게 설명하는 애널리스트다. 아래는 오늘 계산된 체크리스트 결과(JSON)다.
이 결과만 근거로, 경제학을 잘 모르거나 주식 투자가 처음인 사람도 이해할 수 있는 수준의 종합 보고서를 써라.

규칙
- 결과 JSON에 없는 숫자나 사실을 지어내지 마라. 근거가 없으면 "확인 안 됨"이라고 써라.
- 전문용어를 처음 쓸 때는 괄호로 짧게 풀어써라(예: "캐리 트레이드(금리 낮은 나라 돈을 빌려 금리 높은 나라에 투자하는 전략)").
- 존댓말 아닌 평서체로, 과장 없이 담백하게 써라.
- 아래 순서와 내용을 반드시 문단별로 나눠서 포함해라(문단 사이는 빈 줄로 구분).

1문단 — 오늘 하루 요약
1~8단계를 종합해서 오늘 시장 환경이 전반적으로 어땠는지 2~3문장으로 먼저 요약해라.

2문단 — 1·2단계가 3·4단계에 준 영향
1단계(뉴스 리스크·거부권 발동 여부)와 2단계(유동성 점수)가 어떤 상태였는지 설명하고, 이 흐름이
3단계(캐리 트레이드, 미·일 금리차)와 4단계(환율·금·유가 사분면) 지표가 어떻게 움직였는지에 어떤
영향을 줬을 것으로 보이는지 JSON 안의 근거로만 개연성 있게 연결해서 설명해라.

3문단 — 자본이 어디로 이동했는지(5단계), 6·7단계와 비교
5단계 결과(나스닥·러셀 격차, 리스크 선호, 빅테크 동향)를 바탕으로 자본이 어떤 성격으로 움직였는지
설명하고, 6단계(실제 자금이 도착한 섹터)와 7단계(기관·내부자 매집, VIX·공포탐욕지수)의 결과가
5단계와 일치하는지 다른지 비교해서 설명해라.

4문단 — 8단계 계산 과정
1~7단계 결과가 어떻게 8단계 최종 점수로 계산됐는지, 실제 가중치 숫자를 써서 설명해라
(2단계×${WEIGHTS.step2} + 3단계×${WEIGHTS.step3} + 4단계×${WEIGHTS.step4} + 5단계×${WEIGHTS.step5} + 6단계×${WEIGHTS.step6},
합계 ${TOTAL_WEIGHT}로 나눔). 1단계 거부권이 발동됐으면 결론이 어떻게 한 단계 낮아졌는지, 7단계가
매수 비중에 어떻게(또는 안) 반영됐는지도 설명해라.

마지막 문장
오늘 자본이 어디로 몰렸는지(또는 몰리지 않았는지) 한 문장으로 요약하고, 오늘이 주식 투자를 하기에
좋은 환경인지 아닌지를 이 사이트의 최종 결론(매수/지켜보기/현금비중늘리기)에 근거해서 명확히 답하며
마무리해라.

결과 JSON:
${JSON.stringify(report, null, 2)}`;
}

export async function generateComprehensiveReport(report: Parameters<typeof buildComprehensiveReportPrompt>[0]): Promise<string> {
  return generateNarrative(buildComprehensiveReportPrompt(report), MAX_OUTPUT_TOKENS);
}
