import { describe, expect, it } from "vitest";
import { findStrayEnglishWords, toPlainSentenceLines } from "./text-format";

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

describe("findStrayEnglishWords", () => {
  it("한글 문장에 섞인 영어 단어를 찾는다(실측 사례)", () => {
    expect(findStrayEnglishWords("although 통화량 자체는 늘어나고 있지만")).toEqual(["although"]);
    expect(findStrayEnglishWords("앞으로 자금이 어디로 움직일지는 아직 uncertainties(불확실성)합니다.")).toEqual([
      "uncertainties",
    ]);
    expect(findStrayEnglishWords("돈이 조금flows됐지만 뚜렷한 쏠림은 없었습니다.")).toEqual(["flows"]);
  });

  it("대문자 약어와 지수 표기는 예외로 취급한다", () => {
    expect(findStrayEnglishWords("공포지수(VIX)는 14.92로 CPI·PPI·FOMC 발표를 앞두고 있습니다.")).toEqual([]);
    expect(findStrayEnglishWords("S&P500이 다우존스보다 더 올랐습니다.")).toEqual([]);
  });

  it("영어가 섞이지 않은 글은 빈 배열을 반환한다", () => {
    expect(findStrayEnglishWords("오늘은 세계 각국의 긴장이 심해진 하루였습니다.")).toEqual([]);
  });
});
