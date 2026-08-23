import { describe, expect, it } from "vitest";
import {
  gradeHit,
  computeReturnPct,
  gradeVerdicts,
  aggregateHitRate,
  hitStats,
  NEUTRAL_BAND_PCT,
  type PriceSeries,
  type VerdictOutcome,
} from "./verdict-outcomes";

/** 테스트 픽스처 조립기 — VerdictOutcome 필드가 늘어날 때마다 테스트를 고치지 않도록. */
function outcome(o: Partial<VerdictOutcome> & { date: string; finalDecision: string }): VerdictOutcome {
  return {
    marketDate: null,
    sp500ReturnPct: null,
    kospiReturnPct: null,
    hitSp500: null,
    hitKospi: null,
    sp500AnchorDate: null,
    kospiAnchorDate: null,
    ...o,
  };
}

describe("gradeHit", () => {
  it("returns null when returnPct is unknown", () => {
    expect(gradeHit("매수", null)).toBeNull();
  });

  it("매수 hits only when the market rose beyond the neutral band", () => {
    expect(gradeHit("매수", 2.5)).toBe(true);
    expect(gradeHit("매수", -0.1)).toBe(false);
  });

  it("현금비중늘리기 hits only when the market fell beyond the neutral band", () => {
    expect(gradeHit("현금비중늘리기", -1.2)).toBe(true);
    expect(gradeHit("현금비중늘리기", 0.3)).toBe(false);
  });

  // 예전엔 밴드가 "지켜보기"에만 있어서 -0.10%도 "현금비중늘리기 적중"으로 세어졌다.
  // 실데이터에서 S&P 적중 6건 중 3건이 이 구간이었다 — 회귀 방지용 고정.
  it("보합 수준의 움직임은 방향 결론의 적중으로 세지 않는다", () => {
    expect(gradeHit("현금비중늘리기", -0.1)).toBe(false);
    expect(gradeHit("현금비중늘리기", -0.47)).toBe(false);
    expect(gradeHit("현금비중늘리기", -NEUTRAL_BAND_PCT)).toBe(false);
    expect(gradeHit("매수", 0.3)).toBe(false);
    expect(gradeHit("매수", NEUTRAL_BAND_PCT)).toBe(false);
  });

  it("지켜보기 hits only within the neutral band", () => {
    expect(gradeHit("지켜보기", 0.2)).toBe(true);
    expect(gradeHit("지켜보기", -0.4)).toBe(true);
    expect(gradeHit("지켜보기", 1.5)).toBe(false);
  });
});

describe("computeReturnPct", () => {
  // 첫 값(8/03)은 anchorDate 당일이라 기산에서 제외되어야 한다 — 일부러 튀는 값을 넣어 고정한다.
  const series: PriceSeries = [
    { date: "2026-08-03", value: 50 },
    { date: "2026-08-04", value: 100 },
    { date: "2026-08-05", value: 100 },
    { date: "2026-08-06", value: 100 },
    { date: "2026-08-07", value: 100 },
    { date: "2026-08-10", value: 100 },
    { date: "2026-08-11", value: 120 },
  ];

  // 리포트는 8/03 종가가 나온 뒤에 발행되므로 기산은 8/04부터. 8/04 -> 5거래일 뒤 = 8/11.
  it("기산일은 anchorDate 당일이 아니라 다음 거래일이다", () => {
    expect(computeReturnPct(series, "2026-08-03")).toBe(20);
  });

  it("returns null when not enough trading days have elapsed yet", () => {
    expect(computeReturnPct(series, "2026-08-05")).toBeNull();
  });

  it("returns null for an empty series", () => {
    expect(computeReturnPct([], "2026-08-01")).toBeNull();
  });

  it("anchorDate가 비거래일이면 그 뒤 첫 거래일부터 기산한다", () => {
    // 8/02(일)은 봉이 없다 -> 8/03(50)부터 기산, 5거래일 뒤 8/10(100).
    expect(computeReturnPct(series, "2026-08-02")).toBe(100);
  });

  it("anchorDate가 시계열 마지막이면 기산할 다음 거래일이 없어 null", () => {
    expect(computeReturnPct(series, "2026-08-11")).toBeNull();
  });
});

describe("gradeVerdicts", () => {
  it("grades each verdict independently against both indices", () => {
    const sp500: PriceSeries = [
      { date: "2026-08-03", value: 1 },
      { date: "2026-08-04", value: 100 },
      { date: "2026-08-05", value: 100 },
      { date: "2026-08-06", value: 100 },
      { date: "2026-08-07", value: 100 },
      { date: "2026-08-10", value: 100 },
      { date: "2026-08-11", value: 105 },
    ];
    const kospi: PriceSeries = [
      { date: "2026-08-03", value: 1 },
      { date: "2026-08-04", value: 200 },
      { date: "2026-08-05", value: 200 },
      { date: "2026-08-06", value: 200 },
      { date: "2026-08-07", value: 200 },
      { date: "2026-08-10", value: 200 },
      { date: "2026-08-11", value: 190 },
    ];
    const [o] = gradeVerdicts(
      [{ date: "2026-08-04", marketDate: "2026-08-03", finalDecision: "매수" }],
      sp500,
      kospi
    );
    expect(o.hitSp500).toBe(true); // S&P +5% -> 매수 적중
    expect(o.hitKospi).toBe(false); // KOSPI -5% -> 매수 불일치
    expect(o.sp500AnchorDate).toBe("2026-08-04");
  });

  it("uses marketDate over date as the anchor when present", () => {
    const series: PriceSeries = [
      { date: "2026-08-03", value: 1 },
      { date: "2026-08-04", value: 100 },
      { date: "2026-08-05", value: 100 },
      { date: "2026-08-06", value: 100 },
      { date: "2026-08-07", value: 100 },
      { date: "2026-08-10", value: 100 },
      { date: "2026-08-11", value: 130 },
    ];
    const [o] = gradeVerdicts(
      [{ date: "2026-08-07", marketDate: "2026-08-03", finalDecision: "매수" }],
      series,
      null
    );
    expect(o.sp500ReturnPct).toBe(30);
    expect(o.kospiReturnPct).toBeNull();
  });

  // 한·미 휴장일이 다르면 같은 행에서도 두 지수의 기산일이 어긋난다(8/17 광복절 대체공휴일 사례).
  it("지수별 휴장일이 다르면 기산일도 지수별로 다르게 기록된다", () => {
    const sp500: PriceSeries = [
      { date: "2026-08-17", value: 100 },
      { date: "2026-08-18", value: 100 },
    ];
    const kospi: PriceSeries = [{ date: "2026-08-18", value: 200 }];
    const [o] = gradeVerdicts(
      [{ date: "2026-08-18", marketDate: "2026-08-14", finalDecision: "현금비중늘리기" }],
      sp500,
      kospi
    );
    expect(o.sp500AnchorDate).toBe("2026-08-17");
    expect(o.kospiAnchorDate).toBe("2026-08-18");
  });
});

describe("aggregateHitRate / hitStats", () => {
  it("returns null when nothing has been graded yet", () => {
    expect(aggregateHitRate([outcome({ date: "d", finalDecision: "매수" })], "hitSp500")).toBeNull();
    expect(hitStats([outcome({ date: "d", finalDecision: "매수" })], "hitSp500")).toBeNull();
  });

  it("computes the percentage of true hits among graded verdicts", () => {
    const outcomes = [
      outcome({ date: "1", finalDecision: "매수", sp500ReturnPct: 1, hitSp500: true }),
      outcome({ date: "2", finalDecision: "매수", sp500ReturnPct: -1, hitSp500: false }),
      outcome({ date: "3", finalDecision: "매수", sp500ReturnPct: 1, hitSp500: true }),
    ];
    expect(aggregateHitRate(outcomes, "hitSp500")).toBeCloseTo(66.7, 1);
  });

  // 지수마다 휴장일이 달라 분모가 다르다 — 화면이 하나의 "채점 완료 N건"으로 뭉뚱그리던 문제.
  it("지수별 분모를 따로 센다", () => {
    const outcomes = [
      outcome({ date: "1", finalDecision: "매수", hitSp500: true, hitKospi: true }),
      outcome({ date: "2", finalDecision: "매수", hitSp500: false, hitKospi: null }),
    ];
    expect(hitStats(outcomes, "hitSp500")!.graded).toBe(2);
    expect(hitStats(outcomes, "hitKospi")!.graded).toBe(1);
  });

  it("표본이 적으면 신뢰구간이 50%를 포함할 만큼 넓다", () => {
    const outcomes = Array.from({ length: 16 }, (_, i) =>
      outcome({ date: String(i), finalDecision: "매수", hitSp500: i < 6 })
    );
    const s = hitStats(outcomes, "hitSp500")!;
    expect(s.hits).toBe(6);
    expect(s.graded).toBe(16);
    expect(s.pct).toBeCloseTo(37.5, 1);
    expect(s.ciLowPct).toBeLessThan(37.5);
    expect(s.ciHighPct).toBeGreaterThan(50);
  });
});
