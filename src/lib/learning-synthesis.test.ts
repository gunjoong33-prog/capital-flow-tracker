import { describe, expect, it, vi } from "vitest";

// learning-distill.ts(isoWeekKey)를 import하고, learning-distill.ts가 "@/lib/db"를 최상단에서
// import한다 — db.ts는 DATABASE_URL이 없으면 즉시 throw한다(vitest는 .env를 자동 로드하지
// 않음). learning-distill.test.ts와 동일한 방식으로 mock한다.
vi.mock("@/lib/db", () => ({ db: {} }));

import { buildSynthesisPrompt } from "./learning-synthesis";

describe("buildSynthesisPrompt", () => {
  it("노트 개수와 각 노트의 기관·요약을 프롬프트에 포함한다", () => {
    const prompt = buildSynthesisPrompt([
      { category: "자산운용사", sourceName: "PIMCO Cyclical Outlook", summary: "신용 스프레드 확대를 경고했다." },
      { category: "중앙은행", sourceName: "ECB", summary: "소비자 기대조사를 근거로 삼았다." },
    ]);

    expect(prompt).toContain("2건");
    expect(prompt).toContain("PIMCO Cyclical Outlook");
    expect(prompt).toContain("신용 스프레드 확대를 경고했다");
    expect(prompt).toContain("ECB");
  });

  it("특정 기관을 문장 주어로 쓰지 말라는 규칙을 포함한다", () => {
    const prompt = buildSynthesisPrompt([
      { category: "은행", sourceName: "BIS", summary: "정책금리를 근거로 삼았다." },
    ]);

    expect(prompt).toContain("주어로 쓰지 마라");
  });
});
