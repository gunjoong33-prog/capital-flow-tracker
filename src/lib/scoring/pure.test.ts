import { describe, expect, it } from "vitest";
import {
  scoreStep1,
  scoreStep2,
  scoreStep3,
  scoreStep4,
  scoreStep5,
  scoreStep6,
  scoreStep7,
  scoreStep8,
  WEIGHTS,
  TOTAL_WEIGHT,
} from "./pure";
import { NEWS_RISK_INTENSITY_THRESHOLD } from "./types";

describe("scoreStep1", () => {
  const base = { newsRiskScore: 0, hasRecentEventSurprise: false, hasSevereNewsInWindow: false };

  it("강도가 임계값 미만이면 거부권 미발동", () => {
    const result = scoreStep1({ ...base, newsRiskIntensity: NEWS_RISK_INTENSITY_THRESHOLD - 0.01 });
    expect(result.vetoTriggered).toBe(false);
  });

  it("강도가 임계값 이상이면 거부권 발동", () => {
    const result = scoreStep1({ ...base, newsRiskIntensity: NEWS_RISK_INTENSITY_THRESHOLD });
    expect(result.vetoTriggered).toBe(true);
  });

  // 옛 합계 점수(수집량에 비례해 200점대까지 치솟던 값)는 더 이상 판정에 관여하지 않는다.
  // 이 회귀 테스트가 없으면 두 필드를 헷갈려 다시 합계로 판정하는 실수가 조용히 통과한다.
  it("옛 합계 점수(newsRiskScore)는 아무리 커도 단독으로 거부권을 발동시키지 않는다", () => {
    const result = scoreStep1({ ...base, newsRiskScore: 200.9, newsRiskIntensity: 1.0 });
    expect(result.vetoTriggered).toBe(false);
  });

  it("강도가 없는 과거 리포트는 0으로 취급해 점수 경로로는 발동하지 않는다", () => {
    expect(scoreStep1(base).vetoTriggered).toBe(false);
  });

  it("단독 즉시발동 뉴스가 있으면 점수와 무관하게 거부권 발동", () => {
    const result = scoreStep1({ ...base, hasSevereNewsInWindow: true });
    expect(result.vetoTriggered).toBe(true);
    expect(result.reason).toContain("공식");
  });

  it("이벤트 서프라이즈만으로도 발동한다", () => {
    expect(scoreStep1({ ...base, hasRecentEventSurprise: true }).vetoTriggered).toBe(true);
  });
});

describe("scoreStep2", () => {
  const all = (v: number | null) => ({
    walclIncreasing: v, m2GrowthRising2Months: v, reservesRising4Weeks: v,
    rrpDeclining: v, tgaDeclining: v, realRateFallingOrLowFlat: v, creditSpreadNarrowing: v,
  });

  it("해외 지표 7/7 완전 충족이면 10점", () => {
    expect(scoreStep2(all(1)).overseasScore).toBe(10);
  });

  it("전부 완전히 어긋나면 0점", () => {
    expect(scoreStep2(all(0)).overseasScore).toBe(0);
  });

  it("null 지표는 분모에서 제외한다(결측을 미충족으로 세지 않음)", () => {
    const result = scoreStep2({ ...all(null), walclIncreasing: 1 });
    expect(result.overseasTotalCount).toBe(1);
    expect(result.overseasScore).toBe(10);
  });

  it("전부 null이면 중립 5점", () => {
    expect(scoreStep2(all(null)).overseasScore).toBe(5);
  });

  // 이 눈금이 거칠어서 21일 내내 3.33/5.00 두 값만 나왔고 총점 천장을 만들었다 — 회귀 방지.
  it("부분 충족이 점수에 반영된다(옛 이진 방식이면 둘 다 같은 점수였다)", () => {
    const partial = scoreStep2({ ...all(null), walclIncreasing: 0.5, tgaDeclining: 0 });
    const none = scoreStep2({ ...all(null), walclIncreasing: 0, tgaDeclining: 0 });
    expect(partial.overseasScore).toBeGreaterThan(none.overseasScore);
    expect(partial.overseasScore).toBeCloseTo(2.5, 5);
  });

  it("완전 충족 개수와 강도 합계를 따로 보고한다", () => {
    const r = scoreStep2({ ...all(null), walclIncreasing: 1, tgaDeclining: 0.5, m2GrowthRising2Months: 0 });
    expect(r.overseasQualifyingCount).toBe(1); // 화면의 ✓ 개수
    expect(r.overseasTotalCount).toBe(3);
    expect(r.overseasStrengthSum).toBeCloseTo(1.5, 5);
    expect(r.overseasScore).toBeCloseTo(5, 5);
  });
});

describe("scoreStep3", () => {
  it("190bp는 위험 구간", () => {
    const result = scoreStep3({ us10y: 4.0, jp10y: 2.1, spreadBpPercentile: 50, cftcNetPositionPercentile: 50, jpyVolSpike: false });
    expect(result.spreadBp).toBe(190);
    expect(result.zone).toBe("위험");
  });

  it("percentile 하나가 null이면 평균에서 제외한다(중립값 50으로 섞지 않음)", () => {
    const withBoth = scoreStep3({ us10y: 4, jp10y: 2, spreadBpPercentile: 90, cftcNetPositionPercentile: 90, jpyVolSpike: false });
    const withOneNull = scoreStep3({ us10y: 4, jp10y: 2, spreadBpPercentile: 90, cftcNetPositionPercentile: null, jpyVolSpike: false });
    expect(withOneNull.score).toBe(withBoth.score);
    expect(withOneNull.score).toBeCloseTo(9.0, 5);
  });

  it("둘 다 null이면 중립(5.0)", () => {
    const result = scoreStep3({ us10y: 4, jp10y: 2, spreadBpPercentile: null, cftcNetPositionPercentile: null, jpyVolSpike: false });
    expect(result.score).toBe(5);
  });

  it("jpyVolSpike면 percentile이 높아도 score를 2 이하로 하드캡한다", () => {
    const result = scoreStep3({ us10y: 4, jp10y: 2, spreadBpPercentile: 95, cftcNetPositionPercentile: 95, jpyVolSpike: true });
    expect(result.score).toBeLessThanOrEqual(2);
    expect(result.warning).not.toBeNull();
  });
});

describe("scoreStep4", () => {
  const q = { dollarDirection: "up" as const, us30yPercentile: null };

  it("금 하락·실질금리 상승이면 만점(성장주 유리 국면)", () => {
    const result = scoreStep4({ goldDirection: "down", realRateDirection: "up", ...q });
    expect(result.score).toBe(10);
    expect(result.dollarConfirms).toBe(true);
  });

  it("달러가 실질금리와 다른 방향이면 dollarConfirms=false", () => {
    const result = scoreStep4({ goldDirection: "down", realRateDirection: "up", dollarDirection: "down", us30yPercentile: null });
    expect(result.dollarConfirms).toBe(false);
  });

  it("30년물 급등(90%ile+)에 달러 디커플링까지 겹치면 텀프리미엄 급등으로 보고 상한을 절반으로", () => {
    const result = scoreStep4({ goldDirection: "down", realRateDirection: "up", dollarDirection: "down", us30yPercentile: 95 });
    expect(result.score).toBe(5);
  });

  it("30년물이 급등해도 달러가 실질금리와 같은 방향(디커플링 아님)이면 만점 그대로", () => {
    const result = scoreStep4({ goldDirection: "down", realRateDirection: "up", dollarDirection: "up", us30yPercentile: 95 });
    expect(result.score).toBe(10);
  });

  // 변화량 없이 방향 enum만 주면 옛 꼭짓점 점수를 그대로 재현해야 한다(과거 리포트 재계산 호환).
  it("변화량이 없으면 옛 사분면 꼭짓점 점수와 동일하다", () => {
    expect(scoreStep4({ goldDirection: "up", realRateDirection: "up", ...q }).score).toBe(2);
    expect(scoreStep4({ goldDirection: "up", realRateDirection: "down", ...q }).score).toBe(5);
    expect(scoreStep4({ goldDirection: "down", realRateDirection: "up", ...q }).score).toBe(10);
    expect(scoreStep4({ goldDirection: "down", realRateDirection: "down", ...q }).score).toBe(3);
  });

  // 예전엔 2/3/5/10 네 값뿐이라 21일 중 15일이 최하값 2.00에 고정됐다 — 연속화 회귀 방지.
  it("변화량이 작으면 꼭짓점 사이 중간값이 나온다", () => {
    const tiny = scoreStep4({
      goldDirection: "up", realRateDirection: "up", ...q,
      goldChangePct: 0.01, realRateChangeBp: 0.1,
    });
    expect(tiny.score).toBeGreaterThan(2);
    expect(tiny.score).toBeLessThan(10);
    // 변화가 거의 0이면 네 꼭짓점의 평균(2+5+10+3)/4 = 5에 수렴한다.
    expect(tiny.score).toBeCloseTo(5, 1);
  });

  it("변화량이 크면 해당 꼭짓점 값에 수렴한다", () => {
    const strong = scoreStep4({
      goldDirection: "down", realRateDirection: "up", ...q,
      goldChangePct: -5, realRateChangeBp: 80,
    });
    expect(strong.score).toBeGreaterThan(9.5);
  });

  it("사분면 라벨은 방향 enum이 정하고 크기에 흔들리지 않는다", () => {
    const r = scoreStep4({
      goldDirection: "up", realRateDirection: "down", ...q,
      goldChangePct: 0.02, realRateChangeBp: -0.5,
    });
    expect(r.quadrant).toBe("금↑ 실질금리↓/보합");
  });
});

describe("scoreStep5", () => {
  it("코인(BTC+ETH 평균)이 주식(NDX+RUT 평균)보다 수익률이 높으면 true", () => {
    const result = scoreStep5({ ndxReturn20d: 1, rutReturn20d: 1, gapPercentile: 50, djiReturn20d: 0, spxReturn20d: 0, btcReturn20d: 20, ethReturn20d: 20 });
    expect(result.coinMomentumHigherThanStock).toBe(true);
  });

  it("코인이 주식보다 수익률이 낮으면 false", () => {
    const result = scoreStep5({ ndxReturn20d: 10, rutReturn20d: 10, gapPercentile: 50, djiReturn20d: 0, spxReturn20d: 0, btcReturn20d: 1, ethReturn20d: 1 });
    expect(result.coinMomentumHigherThanStock).toBe(false);
  });

  it("코인 데이터가 없으면 null", () => {
    const result = scoreStep5({ ndxReturn20d: 1, rutReturn20d: 1, gapPercentile: 50, djiReturn20d: 0, spxReturn20d: 0, btcReturn20d: null, ethReturn20d: null });
    expect(result.coinMomentumHigherThanStock).toBeNull();
  });

  it("나스닥100이 하락 중이면 점수를 절반으로 감쇠한다(만점 오독 방지)", () => {
    const declining = scoreStep5({ ndxReturn20d: -10, rutReturn20d: 0.5, gapPercentile: 95, djiReturn20d: 0, spxReturn20d: 0, btcReturn20d: null, ethReturn20d: null });
    const rising = scoreStep5({ ndxReturn20d: 10, rutReturn20d: 0.5, gapPercentile: 95, djiReturn20d: 0, spxReturn20d: 0, btcReturn20d: null, ethReturn20d: null });
    expect(declining.score).toBeCloseTo(rising.score * 0.5, 5);
  });

  it("gapPercentile이 null이면 중립 5점(감쇠 전 기준)", () => {
    const result = scoreStep5({ ndxReturn20d: 1, rutReturn20d: 1, gapPercentile: null, djiReturn20d: 0, spxReturn20d: 0, btcReturn20d: null, ethReturn20d: null });
    expect(result.score).toBe(5);
  });
});

describe("scoreStep6", () => {
  const sectors = Array.from({ length: 10 }, (_, i) => ({ name: `S${i}`, return5d: 10 - i, changePct1d: 0, volumeRatio: 2 }));

  it("top3 전부가 거래량까지 충족하면 만점 10점(P0-3 회귀 방지 — 예전엔 분모가 전체 섹터수라 최대 3점이었음)", () => {
    const result = scoreStep6({ sectors });
    expect(result.qualifying.length).toBe(3);
    expect(result.score).toBe(10);
  });

  it("아무도 거래량 기준을 못 채우면 0점", () => {
    const lowVolume = sectors.map((s) => ({ ...s, volumeRatio: 1.0 }));
    expect(scoreStep6({ sectors: lowVolume }).score).toBe(0);
  });
});

describe("scoreStep7", () => {
  it("VIX·공포탐욕 둘 다 과열이면 포지션 배수 0.7", () => {
    const result = scoreStep7({ vix: 12, fearGreed: 80 });
    expect(result.bothOverheated).toBe(true);
    expect(result.oneOverheated).toBe(false);
    expect(result.positionSizeMultiplier).toBe(0.7);
  });

  it("과열 신호 1개(VIX만)면 포지션 배수 0.85", () => {
    const result = scoreStep7({ vix: 12, fearGreed: 50 });
    expect(result.bothOverheated).toBe(false);
    expect(result.oneOverheated).toBe(true);
    expect(result.positionSizeMultiplier).toBe(0.85);
  });

  it("과열 신호 1개(공포탐욕만)면 포지션 배수 0.85", () => {
    const result = scoreStep7({ vix: 20, fearGreed: 80 });
    expect(result.bothOverheated).toBe(false);
    expect(result.oneOverheated).toBe(true);
    expect(result.positionSizeMultiplier).toBe(0.85);
  });

  it("과열 신호 없으면 포지션 배수 1.0", () => {
    const result = scoreStep7({ vix: 20, fearGreed: 50 });
    expect(result.bothOverheated).toBe(false);
    expect(result.oneOverheated).toBe(false);
    expect(result.positionSizeMultiplier).toBe(1.0);
  });
});

describe("scoreStep8", () => {
  const perfectSteps = {
    step2: { overseasScore: 10, overseasQualifyingCount: 7, overseasTotalCount: 7, overseasStrengthSum: 7, finalScore: 10 },
    step3: { spreadBp: 400, zone: "안정" as const, score: 10, warning: null },
    step4: { quadrant: "금↓/보합 실질금리↑", score: 10, note: "", dollarConfirms: true },
    step5: { gapPp: 0, concentrationWarning: false, riskAppetite: "중립" as const, score: 10, cryptoAlignsWithRisk: null, coinMomentumHigherThanStock: null },
    step6: { qualifying: ["a", "b", "c"], score: 10 },
    step7: { bothOverheated: false, oneOverheated: false, fearZone: false, positionSizeMultiplier: 1.0 },
  };

  it("가중치 합은 7.5이고 전 항목 만점이면 매크로 추세점수 10점", () => {
    expect(TOTAL_WEIGHT).toBe(7.5);
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(TOTAL_WEIGHT);
    const result = scoreStep8({ ...perfectSteps, step1: { vetoTriggered: false, reason: "" } });
    expect(result.macroTrendScore).toBe(10);
    expect(result.finalDecision).toBe("매수");
  });

  it("1단계 거부권이 걸리면 매수를 지켜보기로 한 단계 다운그레이드한다", () => {
    const result = scoreStep8({ ...perfectSteps, step1: { vetoTriggered: true, reason: "" } });
    expect(result.finalDecision).toBe("지켜보기");
    expect(result.vetoApplied).toBe(true);
  });

  describe("assetAllocation(자산배분 가이드)", () => {
    it("매수 + 코인 모멘텀 강세면 위험자산 중 코인 비중을 늘린다(15%)", () => {
      const result = scoreStep8({
        ...perfectSteps,
        step1: { vetoTriggered: false, reason: "" },
        step5: { ...perfectSteps.step5, coinMomentumHigherThanStock: true },
      });
      expect(result.finalDecision).toBe("매수");
      expect(result.positionSizePct).toBe(50); // macroTrendScore 10(>=8.5) * multiplier 1.0
      expect(result.assetAllocation).toEqual({ stock: 43, coin: 8, bond: 15, realEstate: 0, cash: 35 });
    });

    it("매수 + 코인 데이터 없으면 코인 비중은 낮게(5%)", () => {
      const result = scoreStep8({ ...perfectSteps, step1: { vetoTriggered: false, reason: "" } });
      expect(result.assetAllocation).toEqual({ stock: 48, coin: 3, bond: 15, realEstate: 0, cash: 35 });
    });

    it("현금비중늘리기(점수 2 미만)면 cashAllocationPct(80) 기준으로 안전자산을 채운다", () => {
      const zeroSteps = {
        step2: { overseasScore: 0, overseasQualifyingCount: 0, overseasTotalCount: 7, overseasStrengthSum: 0, finalScore: 0 },
        step3: { spreadBp: 100, zone: "위험" as const, score: 0, warning: "급등" },
        step4: { quadrant: "금↑ 실질금리↓", score: 0, note: "", dollarConfirms: false },
        step5: { gapPp: 0, concentrationWarning: false, riskAppetite: "중립" as const, score: 0, cryptoAlignsWithRisk: null, coinMomentumHigherThanStock: null },
        step6: { qualifying: [], score: 0 },
        step7: { bothOverheated: false, oneOverheated: false, fearZone: false, positionSizeMultiplier: 1.0 },
      };
      const result = scoreStep8({ ...zeroSteps, step1: { vetoTriggered: false, reason: "" } });
      expect(result.finalDecision).toBe("현금비중늘리기");
      expect(result.cashAllocationPct).toBe(80);
      expect(result.assetAllocation).toEqual({ stock: 19, coin: 1, bond: 24, realEstate: 0, cash: 56 });
    });

    it("지켜보기(positionSizePct·cashAllocationPct 둘 다 없음)면 위험:안전 50:50을 기준으로 채운다", () => {
      const midSteps = {
        step2: { overseasScore: 6, overseasQualifyingCount: 4, overseasTotalCount: 7, overseasStrengthSum: 4, finalScore: 6 },
        step3: { spreadBp: 250, zone: "위험" as const, score: 6, warning: null },
        step4: { quadrant: "금↓/보합 실질금리↑", score: 6, note: "", dollarConfirms: true },
        step5: { gapPp: 0, concentrationWarning: false, riskAppetite: "중립" as const, score: 6, cryptoAlignsWithRisk: null, coinMomentumHigherThanStock: null },
        step6: { qualifying: ["a"], score: 6 },
        step7: { bothOverheated: false, oneOverheated: false, fearZone: false, positionSizeMultiplier: 1.0 },
      };
      const result = scoreStep8({ ...midSteps, step1: { vetoTriggered: false, reason: "" } });
      expect(result.finalDecision).toBe("지켜보기");
      expect(result.positionSizePct).toBeNull();
      expect(result.cashAllocationPct).toBeNull();
      expect(result.assetAllocation).toEqual({ stock: 48, coin: 3, bond: 15, realEstate: 0, cash: 35 });
    });

    it("realEstate는 항상 0(이 사이트에 실제 신호가 없음)", () => {
      const result = scoreStep8({ ...perfectSteps, step1: { vetoTriggered: false, reason: "" } });
      expect(result.assetAllocation.realEstate).toBe(0);
    });
  });
});
