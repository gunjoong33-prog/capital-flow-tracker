// 자금흐름 예측 — 오늘 신호로 방향만 판정한다. 과거 국면 통계를 역산하지 않는다(9차 방법론
// 재검토 결론: whipsaw·자기상관 유사표본·룩어헤드 편향·다중비교·기저율 무시 문제를 전부
// 피하려면, 과거를 캐서 확률을 만드는 대신 매일 새로 판정하고 나중에(verdict-outcomes.ts와
// 같은 방식으로) 정직하게 채점하는 쪽이 이 사이트의 원칙과 거장들의 조언(Marks "예측 대신
// 준비"·Soros "정량화 못 하는 불확실성"·Taleb "다중비교는 필연적으로 가짜 유의성을 만듦")에
// 맞다). 채권·부동산은 실제 수익률 시계열이 없어 판정 대상에서 제외(자산배분 가이드와 동일 원칙).
import type {
  Step4Result,
  Step5Result,
  CapitalFlowForecast,
  CapitalFlowForecastAsset,
  CapitalFlowForecastAssetKey,
} from "./scoring/types";

export function computeCapitalFlowForecast(
  step4: Step4Result,
  step5: Step5Result,
  marketDate: string
): CapitalFlowForecast {
  const goldUp = step4.quadrant.startsWith("금↑");
  const rateUp = step4.quadrant.includes("실질금리↑");
  const coinUp = step5.coinMomentumHigherThanStock === true;

  const directions: Record<CapitalFlowForecastAssetKey, { direction: "up" | "down"; reason: string }> = {
    gold: {
      direction: goldUp ? "up" : "down",
      reason: goldUp ? "4단계 사분면이 금↑로 판정됨" : "4단계 사분면이 금↓/보합으로 판정됨",
    },
    coin: {
      direction: coinUp ? "up" : "down",
      reason: coinUp
        ? "5단계: (BTC+ETH)/2 20일 수익률이 (NDX+RUT)/2보다 높음"
        : "5단계: 코인 모멘텀이 주식보다 약하거나 코인 데이터 없음",
    },
    stock: {
      direction: rateUp ? "down" : "up",
      reason: rateUp
        ? "4단계 사분면이 실질금리↑ — 밸류에이션 압박 신호"
        : "4단계 사분면이 실질금리↓/보합 — 밸류에이션 압박 신호 없음",
    },
  };

  // 순위는 확신도 점수화 없이 고정 우선순위(코인→주식→금)로 배정한다 — 새 임의 가중치를
  // 만들지 않기 위한 의도적 단순화(YAGNI, 계획 문서 Global Constraints 참고).
  const order: CapitalFlowForecastAssetKey[] = ["coin", "stock", "gold"];
  const assets: CapitalFlowForecastAsset[] = order.map((asset, i) => ({
    asset,
    direction: directions[asset].direction,
    rank: i + 1,
    reason: directions[asset].reason,
  }));

  return { computedAt: marketDate, assets };
}
