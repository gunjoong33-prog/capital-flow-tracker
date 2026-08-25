import { describe, expect, it, vi } from "vitest";

// narrative.ts는 이제 narrative-learning-context.ts(fetchRecentLearningContext)를 import하고,
// 그 파일이 최상단에서 "@/lib/db"를 import한다 — db.ts는 DATABASE_URL이 process.env에 없으면
// 즉시 throw한다(vitest는 .env를 자동 로드하지 않음). external-consensus.test.ts·
// learning-distill.test.ts·self-diagnosis.test.ts와 동일한 방식으로 mock한다.
vi.mock("@/lib/db", () => ({ db: {} }));

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
