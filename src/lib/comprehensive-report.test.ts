import { describe, expect, it, vi } from "vitest";

// comprehensive-report.ts는 narrative.ts를 import하고, narrative.ts는 narrative-learning-context.ts를
// import하며 그 파일이 최상단에서 "@/lib/db"를 읽는다 — narrative.test.ts와 동일하게 mock한다.
vi.mock("@/lib/db", () => ({ db: {} }));

const { generateNarrativeMock } = vi.hoisted(() => ({ generateNarrativeMock: vi.fn() }));
vi.mock("@/lib/narrative", () => ({ generateNarrative: generateNarrativeMock }));

import { sanitizeFormat, generateComprehensiveReport } from "./comprehensive-report";

describe("generateComprehensiveReport", () => {
  const minimalReport = { step1: {}, step2: {}, step3: {}, step4: {}, step5: {}, step6: {}, step7: {}, step8: {}, details: {} };

  it("options를 generateNarrative에 그대로 전달한다", async () => {
    generateNarrativeMock.mockReset().mockResolvedValue("본문");

    await generateComprehensiveReport(minimalReport, { skipLearningContext: true });

    const [, , passedOptions] = generateNarrativeMock.mock.calls[0] as [string, number, { skipLearningContext?: boolean }];
    expect(passedOptions).toEqual({ skipLearningContext: true });
  });

  it("options 생략 시 undefined를 그대로 전달한다(기존 동작 유지)", async () => {
    generateNarrativeMock.mockReset().mockResolvedValue("본문");

    await generateComprehensiveReport(minimalReport);

    const [, , passedOptions] = generateNarrativeMock.mock.calls[0] as [string, number, unknown];
    expect(passedOptions).toBeUndefined();
  });
});

describe("sanitizeFormat", () => {
  it("굵은 번호 소제목 줄을 제거한다(9/1 리포트 실측 사례)", () => {
    const text =
      "**① 오늘 시장을 움직인 주요 요인은 무엇입니까?**\n오늘은 세계 각지에서 위험 상황이 있었습니다.\n\n**② 지금이 좋은 때입니까?**\n환경이 좋지 않습니다.";
    const result = sanitizeFormat(text);
    expect(result).not.toContain("**");
    expect(result).not.toContain("①");
    expect(result).toContain("오늘은 세계 각지에서 위험 상황이 있었습니다.");
    expect(result).toContain("환경이 좋지 않습니다.");
  });

  it("상투적인 도입 문장을 제거한다(8/31 리포트 실측 사례)", () => {
    const text = "오늘 하루를 정리합니다.\n\n오늘 자본의 방향을 바꾼 사건은 다음과 같습니다.";
    expect(sanitizeFormat(text)).toBe("오늘 자본의 방향을 바꾼 사건은 다음과 같습니다.");
  });

  it("정상 형식(소제목 없음)은 그대로 둔다", () => {
    const text = "오늘 시장을 움직인 가장 큰 이유는 국제적인 긴장이었습니다.";
    expect(sanitizeFormat(text)).toBe(text);
  });
});
