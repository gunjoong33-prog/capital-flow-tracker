import { describe, expect, it, vi } from "vitest";

// buildDistillPrompt는 순수함수라 db를 쓰지 않지만, learning-distill.ts가 모듈 최상단에서
// "@/lib/db"를 import하고 db.ts는 DATABASE_URL이 process.env에 없으면 즉시 throw한다(vitest는
// .env를 자동 로드하지 않음) — external-consensus.test.ts와 동일한 방식으로 mock한다.
vi.mock("@/lib/db", () => ({ db: {} }));

import { buildDistillPrompt } from "./learning-distill";

describe("buildDistillPrompt", () => {
  it("소스명·데이터 개수를 프롬프트에 포함한다", () => {
    const prompt = buildDistillPrompt("Bridgewater Associates", [
      { sourceType: "13f", date: new Date("2026-08-14"), payload: { nameOfIssuer: "APPLE INC" } },
    ]);

    expect(prompt).toContain("Bridgewater Associates");
    expect(prompt).toContain("APPLE INC");
  });
});
