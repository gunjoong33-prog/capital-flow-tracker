import { describe, expect, it } from "vitest";
import { toPlainSentenceLines } from "./text-format";

describe("toPlainSentenceLines", () => {
  it("마크다운 볼드를 제거한다", () => {
    const result = toPlainSentenceLines("이 기관은 **인플레이션 지표**를 근거로 삼는다.");
    expect(result).not.toContain("**");
    expect(result).toBe("이 기관은 인플레이션 지표를 근거로 삼는다.");
  });

  it("번호+라벨 프리픽스를 제거한다(실측 사례)", () => {
    const result = toPlainSentenceLines(
      "① **지표 근거**: DS투자증권은 임상 데이터를 근거로 삼는다. ② **논리 해석**: 결과가 우수하면 경쟁력을 확보한다."
    );
    expect(result).not.toMatch(/[①②]/);
    expect(result).toBe("DS투자증권은 임상 데이터를 근거로 삼는다.\n결과가 우수하면 경쟁력을 확보한다.");
  });

  it("문장을 한 줄에 하나씩 배치한다", () => {
    const result = toPlainSentenceLines("첫 문장이다. 둘째 문장이다. 셋째 문장이다.");
    expect(result.split("\n")).toEqual(["첫 문장이다.", "둘째 문장이다.", "셋째 문장이다."]);
  });

  it("소수점 숫자의 마침표는 문장으로 안 쪼갠다", () => {
    const result = toPlainSentenceLines("점수는 3.45점으로 낮아졌다.");
    expect(result.split("\n")).toHaveLength(1);
  });
});
