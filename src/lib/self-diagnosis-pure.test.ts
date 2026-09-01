import { describe, expect, it } from "vitest";
import { detectDivergence } from "./self-diagnosis-pure";

describe("detectDivergence", () => {
  it("표본이 8건 미만이면 신뢰구간 계산 없이 판단을 보류한다", () => {
    const verdicts = Array.from({ length: 7 }, (_, i) => ({ date: `2026-08-${20 + i}`, hit: false }));

    expect(detectDivergence(verdicts)).toEqual([]);
  });

  it("표본은 충분해도 신뢰구간 상한이 50%를 넘으면(우연일 수 있으면) 이상으로 보지 않는다", () => {
    // 10건 중 3건 적중(30%) — 관찰값은 동전 던지기보다 낮아 보이지만, 95% 신뢰구간 상한은
    // 50%를 넘는다(표본이 이 정도로는 "우연이 아니다"라고 확신할 수 없다).
    const verdicts = [
      { date: "2026-08-11", hit: true },
      { date: "2026-08-12", hit: false },
      { date: "2026-08-13", hit: true },
      { date: "2026-08-14", hit: false },
      { date: "2026-08-15", hit: false },
      { date: "2026-08-16", hit: true },
      { date: "2026-08-17", hit: false },
      { date: "2026-08-18", hit: false },
      { date: "2026-08-19", hit: false },
      { date: "2026-08-20", hit: false },
    ];

    expect(detectDivergence(verdicts)).toEqual([]);
  });

  it("표본이 충분하고 신뢰구간 상한이 50% 밑이면 이상으로 본다", () => {
    // 8건 전부 실패 — 95% 신뢰구간 상한이 50%를 확실히 밑돈다.
    const verdicts = Array.from({ length: 8 }, (_, i) => ({ date: `2026-08-${13 + i}`, hit: false }));

    const patterns = detectDivergence(verdicts);

    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ kind: "low_hit_rate", count: 8 });
    expect(patterns[0].detail).toContain("0건 적중");
  });

  it("hit이 null(채점 불가)인 건 표본에서 제외한다 — 제외 후 8건 미만이면 보류", () => {
    const verdicts = [
      { date: "2026-08-12", hit: null },
      ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-08-${13 + i}`, hit: false })),
    ];

    // null 하나 제외하면 채점 가능 표본은 7건 — MIN_SAMPLE(8) 미만이라 보류.
    expect(detectDivergence(verdicts)).toEqual([]);
  });

  it("null 제외 후 표본이 8건 이상 남고 저조하면 이상으로 본다", () => {
    const verdicts = [
      { date: "2026-08-11", hit: null },
      { date: "2026-08-12", hit: null },
      ...Array.from({ length: 8 }, (_, i) => ({ date: `2026-08-${13 + i}`, hit: false })),
    ];

    const patterns = detectDivergence(verdicts);

    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ count: 8 });
  });
});
