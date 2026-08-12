import { describe, expect, it } from "vitest";
import { gradeHit, computeReturnPct, gradeVerdicts, aggregateHitRate, type PriceSeries } from "./verdict-outcomes";

describe("gradeHit", () => {
  it("returns null when returnPct is unknown", () => {
    expect(gradeHit("매수", null)).toBeNull();
  });

  it("매수 hits when the market rose", () => {
    expect(gradeHit("매수", 2.5)).toBe(true);
    expect(gradeHit("매수", -0.1)).toBe(false);
  });

  it("현금비중늘리기 hits when the market fell", () => {
    expect(gradeHit("현금비중늘리기", -1.2)).toBe(true);
    expect(gradeHit("현금비중늘리기", 0.3)).toBe(false);
  });

  it("지켜보기 hits only within the neutral band", () => {
    expect(gradeHit("지켜보기", 0.2)).toBe(true);
    expect(gradeHit("지켜보기", -0.4)).toBe(true);
    expect(gradeHit("지켜보기", 1.5)).toBe(false);
  });
});

describe("computeReturnPct", () => {
  const series: PriceSeries = [
    { date: "2026-08-01", value: 100 },
    { date: "2026-08-02", value: 101 },
    { date: "2026-08-03", value: 102 },
    { date: "2026-08-04", value: 103 },
    { date: "2026-08-05", value: 104 },
    { date: "2026-08-06", value: 110 },
  ];

  it("computes % change from anchor date to 5 trading days later", () => {
    expect(computeReturnPct(series, "2026-08-01")).toBe(10);
  });

  it("returns null when not enough trading days have elapsed yet", () => {
    expect(computeReturnPct(series, "2026-08-05")).toBeNull();
  });

  it("returns null when the anchor date is before the series starts", () => {
    expect(computeReturnPct([], "2026-08-01")).toBeNull();
  });

  it("snaps to the first trading day on/after a non-trading anchor date", () => {
    // 08-01 하루 뒤로 앵커를 옮겨도(주말 등으로 정확히 그 날짜가 없어도) 그다음 첫 거래일부터 기산
    const gapSeries: PriceSeries = [
      { date: "2026-08-03", value: 100 },
      { date: "2026-08-04", value: 100 },
      { date: "2026-08-05", value: 100 },
      { date: "2026-08-06", value: 100 },
      { date: "2026-08-07", value: 100 },
      { date: "2026-08-10", value: 120 },
    ];
    expect(computeReturnPct(gapSeries, "2026-08-02")).toBe(20);
  });
});

describe("gradeVerdicts", () => {
  it("grades each verdict independently against both indices", () => {
    const sp500: PriceSeries = [
      { date: "2026-08-01", value: 100 },
      { date: "2026-08-02", value: 100 },
      { date: "2026-08-03", value: 100 },
      { date: "2026-08-04", value: 100 },
      { date: "2026-08-05", value: 100 },
      { date: "2026-08-06", value: 105 },
    ];
    const kospi: PriceSeries = [
      { date: "2026-08-01", value: 200 },
      { date: "2026-08-02", value: 200 },
      { date: "2026-08-03", value: 200 },
      { date: "2026-08-04", value: 200 },
      { date: "2026-08-05", value: 200 },
      { date: "2026-08-06", value: 190 },
    ];
    const [outcome] = gradeVerdicts([{ date: "2026-08-01", marketDate: null, finalDecision: "매수" }], sp500, kospi);
    expect(outcome.hitSp500).toBe(true); // S&P 상승 → 매수 적중
    expect(outcome.hitKospi).toBe(false); // KOSPI 하락 → 매수 불일치
  });

  it("uses marketDate over date as the anchor when present", () => {
    const series: PriceSeries = [
      { date: "2026-08-01", value: 100 },
      { date: "2026-08-02", value: 100 },
      { date: "2026-08-03", value: 100 },
      { date: "2026-08-04", value: 100 },
      { date: "2026-08-05", value: 100 },
      { date: "2026-08-06", value: 130 },
    ];
    const [outcome] = gradeVerdicts([{ date: "2026-08-05", marketDate: "2026-08-01", finalDecision: "매수" }], series, null);
    expect(outcome.sp500ReturnPct).toBe(30);
    expect(outcome.kospiReturnPct).toBeNull();
  });
});

describe("aggregateHitRate", () => {
  it("returns null when nothing has been graded yet", () => {
    expect(aggregateHitRate([{ date: "d", finalDecision: "매수", sp500ReturnPct: null, kospiReturnPct: null, hitSp500: null, hitKospi: null }], "hitSp500")).toBeNull();
  });

  it("computes the percentage of true hits among graded verdicts", () => {
    const outcomes = [
      { date: "1", finalDecision: "매수", sp500ReturnPct: 1, kospiReturnPct: null, hitSp500: true, hitKospi: null },
      { date: "2", finalDecision: "매수", sp500ReturnPct: -1, kospiReturnPct: null, hitSp500: false, hitKospi: null },
      { date: "3", finalDecision: "매수", sp500ReturnPct: 1, kospiReturnPct: null, hitSp500: true, hitKospi: null },
    ];
    expect(aggregateHitRate(outcomes, "hitSp500")).toBeCloseTo(66.7, 1);
  });
});
