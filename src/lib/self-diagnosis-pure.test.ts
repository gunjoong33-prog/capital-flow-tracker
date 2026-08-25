import { describe, expect, it } from "vitest";
import { detectDivergence } from "./self-diagnosis-pure";

describe("detectDivergence", () => {
  it("최근 판정이 연속 불일치(hit=false)면서 표본이 최소치 이상이면 괴리로 본다", () => {
    const verdicts = [
      { date: "2026-08-20", hit: false },
      { date: "2026-08-21", hit: false },
      { date: "2026-08-22", hit: false },
      { date: "2026-08-23", hit: false },
    ];

    const patterns = detectDivergence(verdicts);

    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ kind: "consecutive_miss", count: 4 });
  });

  it("표본이 3건 미만이면 판단 보류(과최적화 방지)", () => {
    const verdicts = [
      { date: "2026-08-22", hit: false },
      { date: "2026-08-23", hit: false },
    ];

    expect(detectDivergence(verdicts)).toEqual([]);
  });

  it("hit이 null(채점 불가)인 건 표본에서 제외한다", () => {
    const verdicts = [
      { date: "2026-08-20", hit: null },
      { date: "2026-08-21", hit: false },
      { date: "2026-08-22", hit: false },
      { date: "2026-08-23", hit: false },
    ];

    const patterns = detectDivergence(verdicts);

    expect(patterns[0]).toMatchObject({ count: 3 });
  });

  it("적중이 섞여 있으면 연속 실패로 안 본다", () => {
    const verdicts = [
      { date: "2026-08-20", hit: true },
      { date: "2026-08-21", hit: false },
      { date: "2026-08-22", hit: false },
      { date: "2026-08-23", hit: false },
    ];

    expect(detectDivergence(verdicts)).toEqual([]);
  });
});
