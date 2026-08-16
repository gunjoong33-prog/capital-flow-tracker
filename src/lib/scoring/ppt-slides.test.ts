import { describe, expect, it } from "vitest";
import { buildPptSlides } from "./ppt-slides";
import type { Step1Result, Step2Result, Step3Result, Step4Result, Step5Result, Step6Result, Step7Result, Step8Result } from "./types";

function baseInput() {
  const step1: Step1Result = { vetoTriggered: true, reason: "테스트 사유" };
  const step2: Step2Result = { overseasScore: 3.3, overseasQualifyingCount: 2, overseasTotalCount: 6, finalScore: 3.3 };
  const step3: Step3Result = { zone: "위험", score: 4.2, warning: null, spreadBp: 192 };
  const step4: Step4Result = { quadrant: "금↑ 실질금리↑", score: 2, note: "", dollarConfirms: false };
  const step5: Step5Result = { gapPp: -2.25, concentrationWarning: false, riskAppetite: "위험선호", score: 3.0, cryptoAlignsWithRisk: null };
  const step6: Step6Result = { qualifying: [], score: 0 };
  const step7: Step7Result = { bothOverheated: false, oneOverheated: true, fearZone: false, positionSizeMultiplier: 1.0 };
  const step8: Step8Result = { macroTrendScore: 2.95, finalDecision: "현금비중늘리기", vetoApplied: true, positionSizePct: null, cashAllocationPct: 70 };
  return {
    step1, step2, step3, step4, step5, step6, step7, step8,
    step2Summary: "해외 유동성 지표 2/6개가 우호적 방향입니다.",
    step3Summary: "US10Y-JP10Y 스프레드가 192bp로 위험 구간입니다.",
    step4Summary: "현재 사분면은 금↑ 실질금리↑입니다.",
    step5Summary: "나스닥100·러셀2000 격차 -2.25%p입니다.",
    step6Summary: "5일 수익률 상위 3위이면서 거래량까지 급증한 섹터는 없습니다.",
    step7Summary: "VIX는 14.90로 과열 구간입니다.",
    vix: 14.9,
    fearGreed: 63.7,
    sectors: [
      { name: "방산(SHLD)", return5d: 9.15, volumeRatio: 1.1 },
      { name: "기술서비스(XLK)", return5d: 3.2, volumeRatio: 0.9 },
    ],
    bigTechMovers: [
      { ticker: "TSLA", label: "테슬라", changePct: 2.83, reason: "JPMorgan 목표주가 상향" },
      { ticker: "GOOGL", label: "알파벳", changePct: -0.96, reason: "SpaceX 주가 급락 여파" },
    ],
  };
}

describe("buildPptSlides", () => {
  it("9개 슬라이드를 반환한다(1~8단계 + 종합 결론)", () => {
    const slides = buildPptSlides(baseInput());
    expect(slides).toHaveLength(9);
    expect(slides.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("1번 슬라이드는 거부권 여부와 최종 점수를 stat-pair로 담는다", () => {
    const slides = buildPptSlides(baseInput());
    const s1 = slides[0];
    expect(s1.kicker).toBe("사실 · 오늘의 결론");
    expect(s1.visual).toEqual({
      type: "stat-pair",
      left: { value: "2.95", label: "투자 적합도", tone: "accent" },
      right: { value: "거부권", label: "1단계 발동", tone: "neg" },
    });
  });

  it("2번 슬라이드는 유동성 우호 지표 비율을 ratio-bar로 담는다", () => {
    const slides = buildPptSlides(baseInput());
    expect(slides[1].visual).toEqual({ type: "ratio-bar", qualifying: 2, total: 6, label: "유동성 우호 지표" });
  });

  it("3번 슬라이드는 캐리 스프레드 vs 안전마진 350bp를 bar-pair로 담는다", () => {
    const slides = buildPptSlides(baseInput());
    const visual = slides[2].visual;
    if (visual.type !== "bar-pair") throw new Error("bar-pair 아님");
    expect(visual.left).toEqual({ value: "192bp", label: "현재 스프레드", heightPct: Math.round((192 / 350) * 100) });
    expect(visual.right).toEqual({ value: "350bp", label: "안전 마진", heightPct: 100 });
  });

  it("5번 슬라이드는 최대 상승·하락 빅테크 종목을 stat-pair로 담는다", () => {
    const slides = buildPptSlides(baseInput());
    expect(slides[4].visual).toEqual({
      type: "stat-pair",
      left: { value: "+2.83%", label: "테슬라", tone: "pos" },
      right: { value: "-0.96%", label: "알파벳", tone: "neg" },
    });
  });

  it("6번 슬라이드는 빈 sectors 배열이면 none 비주얼로 안전하게 폴백한다", () => {
    const input = baseInput();
    input.sectors = [];
    const slides = buildPptSlides(input);
    expect(slides[5].visual).toEqual({ type: "none" });
  });

  it("9번(종합 결론) 슬라이드는 최종 점수·결론 배지를 담는다", () => {
    const slides = buildPptSlides(baseInput());
    const s9 = slides[8];
    expect(s9.step).toBe(9);
    expect(s9.kicker).toBe("결론");
    expect(s9.visual).toEqual({
      type: "stat-pair",
      left: { value: "2.95", label: "투자 적합도", tone: "accent" },
      right: { value: "현금비중늘리기", label: "최종 결론" },
    });
  });

  it("headline 초기값은 kicker와 같다(LLM 실패 시 폴백 겸용)", () => {
    const slides = buildPptSlides(baseInput());
    expect(slides[0].headline).toBe(slides[0].kicker);
  });
});
