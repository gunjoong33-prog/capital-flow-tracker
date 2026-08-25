import { describe, expect, it } from "vitest";
import { buildDailyNarrativePrompt } from "./narrative";

describe("buildDailyNarrativePrompt", () => {
  it("원인-결과-향후 전망 구조를 프롬프트에 명시한다", () => {
    const prompt = buildDailyNarrativePrompt({
      step1: {},
      step2: {},
      step3: {},
      step4: {},
      step5: {},
      step6: {},
      step7: {},
      step8: {},
    });

    expect(prompt).toContain("원인");
    expect(prompt).toContain("향후");
    expect(prompt).toContain("쉬운 문장");
  });

  it("learningContext를 넘기면 프롬프트에 포함한다", () => {
    const prompt = buildDailyNarrativePrompt(
      {
        step1: {},
        step2: {},
        step3: {},
        step4: {},
        step5: {},
        step6: {},
        step7: {},
        step8: {},
      },
      "참고: Bridgewater는 정책금리 방향을 최우선으로 본다."
    );

    expect(prompt).toContain("Bridgewater");
  });
});
