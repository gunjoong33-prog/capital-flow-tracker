import { describe, expect, it } from "vitest";
import { computeCapitalFlowForecast } from "./capital-flow-forecast";
import type { Step4Result, Step5Result } from "./scoring/types";

const step4Base: Step4Result = { quadrant: "금↓/보합 실질금리↑", score: 5, note: "", dollarConfirms: false };
const step5Base: Step5Result = {
  gapPp: 0,
  concentrationWarning: false,
  riskAppetite: "중립",
  score: 5,
  cryptoAlignsWithRisk: null,
  coinMomentumHigherThanStock: null,
};

describe("computeCapitalFlowForecast", () => {
  it("금↓ 실질금리↑ + 코인 모멘텀 약세면 주식 down·코인 down·금 down", () => {
    const result = computeCapitalFlowForecast(step4Base, step5Base, "2026-09-05");
    const byAsset = Object.fromEntries(result.assets.map((a) => [a.asset, a.direction]));
    expect(byAsset.stock).toBe("down");
    expect(byAsset.coin).toBe("down");
    expect(byAsset.gold).toBe("down");
  });

  it("금↑ 실질금리↓/보합 + 코인 모멘텀 강세면 금 up·코인 up·주식 up", () => {
    const step4: Step4Result = { ...step4Base, quadrant: "금↑ 실질금리↓/보합" };
    const step5: Step5Result = { ...step5Base, coinMomentumHigherThanStock: true };
    const result = computeCapitalFlowForecast(step4, step5, "2026-09-05");
    const byAsset = Object.fromEntries(result.assets.map((a) => [a.asset, a.direction]));
    expect(byAsset.gold).toBe("up");
    expect(byAsset.coin).toBe("up");
    expect(byAsset.stock).toBe("up");
  });

  it("자산 3개(주식·코인·금) 전부 순위(1~3)가 매겨진다", () => {
    const result = computeCapitalFlowForecast(step4Base, step5Base, "2026-09-05");
    const ranks = result.assets.map((a) => a.rank).sort();
    expect(ranks).toEqual([1, 2, 3]);
  });

  it("computedAt에 넘긴 marketDate가 그대로 들어간다", () => {
    const result = computeCapitalFlowForecast(step4Base, step5Base, "2026-08-01");
    expect(result.computedAt).toBe("2026-08-01");
  });
});
