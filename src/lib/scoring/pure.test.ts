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
import { NEWS_RISK_SCORE_THRESHOLD } from "./types";

describe("scoreStep1", () => {
  it("가중점수가 임계값 미만이면 거부권 미발동", () => {
    const result = scoreStep1({
      newsRiskScore: NEWS_RISK_SCORE_THRESHOLD - 0.1,
      hasRecentEventSurprise: false,
      hasSevereNewsInWindow: false,
    });
    expect(result.vetoTriggered).toBe(false);
  });

  it("가중점수가 임계값 이상이면 거부권 발동", () => {
    const result = scoreStep1({
      newsRiskScore: NEWS_RISK_SCORE_THRESHOLD,
      hasRecentEventSurprise: false,
      hasSevereNewsInWindow: false,
    });
    expect(result.vetoTriggered).toBe(true);
  });

  it("단독 즉시발동 뉴스가 있으면 점수와 무관하게 거부권 발동", () => {
    const result = scoreStep1({ newsRiskScore: 0, hasRecentEventSurprise: false, hasSevereNewsInWindow: true });
    expect(result.vetoTriggered).toBe(true);
  });
});

describe("scoreStep2", () => {
  it("해외 지표 7/7 충족이면 10점", () => {
    const flags = { walclIncreasing: true, m2GrowthRising2Months: true, reservesRising4Weeks: true, rrpDeclining: true, tgaDeclining: true, realRateFallingOrLowFlat: true, creditSpreadNarrowing: true };
    expect(scoreStep2(flags).overseasScore).toBe(10);
  });

  it("null 지표는 분모에서 제외한다(결측을 미충족으로 세지 않음)", () => {
    const result = scoreStep2({ walclIncreasing: true, m2GrowthRising2Months: null, reservesRising4Weeks: null, rrpDeclining: null, tgaDeclining: null, realRateFallingOrLowFlat: null, creditSpreadNarrowing: null });
    expect(result.overseasTotalCount).toBe(1);
    expect(result.overseasScore).toBe(10);
  });

  it("전부 null이면 중립 5점", () => {
    const result = scoreStep2({ walclIncreasing: null, m2GrowthRising2Months: null, reservesRising4Weeks: null, rrpDeclining: null, tgaDeclining: null, realRateFallingOrLowFlat: null, creditSpreadNarrowing: null });
    expect(result.overseasScore).toBe(5);
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
  it("금 하락·실질금리 상승이면 만점(성장주 유리 국면)", () => {
    const result = scoreStep4({ goldDirection: "down", realRateDirection: "up", dollarDirection: "up", us30yPercentile: null });
    expect(result.score).toBe(10);
    expect(result.dollarConfirms).toBe(true);
  });

  it("달러가 실질금리와 다른 방향이면 dollarConfirms=false", () => {
    const result = scoreStep4({ goldDirection: "down", realRateDirection: "up", dollarDirection: "down", us30yPercentile: null });
    expect(result.dollarConfirms).toBe(false);
  });

  it("30년물 급등(90%ile+)에 달러 디커플링까지 겹치면 텀프리미엄 급등으로 보고 만점을 절반으로 낮춘다", () => {
    const result = scoreStep4({ goldDirection: "down", realRateDirection: "up", dollarDirection: "down", us30yPercentile: 95 });
    expect(result.score).toBe(5);
  });

  it("30년물이 급등해도 달러가 실질금리와 같은 방향(디커플링 아님)이면 만점 그대로", () => {
    const result = scoreStep4({ goldDirection: "down", realRateDirection: "up", dollarDirection: "up", us30yPercentile: 95 });
    expect(result.score).toBe(10);
  });
});

describe("scoreStep5", () => {
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
    step2: { overseasScore: 10, overseasQualifyingCount: 7, overseasTotalCount: 7, finalScore: 10 },
    step3: { spreadBp: 400, zone: "안정" as const, score: 10, warning: null },
    step4: { quadrant: "금↓ 실질금리↑", score: 10, note: "", dollarConfirms: true },
    step5: { gapPp: 0, concentrationWarning: false, riskAppetite: "중립" as const, score: 10, cryptoAlignsWithRisk: null },
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
});
