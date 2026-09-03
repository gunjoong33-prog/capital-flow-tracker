import { describe, expect, it, vi } from "vitest";

// buildDistillPrompt는 순수함수라 db를 쓰지 않지만, learning-distill.ts가 모듈 최상단에서
// "@/lib/db"를 import하고 db.ts는 DATABASE_URL이 process.env에 없으면 즉시 throw한다(vitest는
// .env를 자동 로드하지 않음) — external-consensus.test.ts와 동일한 방식으로 mock한다.
vi.mock("@/lib/db", () => ({ db: {} }));

import { buildDistillPrompt } from "./learning-distill";

describe("buildDistillPrompt", () => {
  it("소스명·데이터 개수를 프롬프트에 포함한다", () => {
    const prompt = buildDistillPrompt("Bridgewater Associates", [
      { id: "test-id-1", sourceType: "13f", date: new Date("2026-08-14"), payload: { nameOfIssuer: "APPLE INC" } },
    ]);

    expect(prompt).toContain("Bridgewater Associates");
    expect(prompt).toContain("APPLE INC");
  });

  it("배열 payload가 20건을 넘으면 valueThousands 기준 상위 20건만 포함하고 절단 안내를 남긴다", () => {
    const holdings = Array.from({ length: 50 }, (_, i) => ({
      nameOfIssuer: `COMPANY ${i}`,
      valueThousands: i, // 0~49, 내림차순 정렬하면 49가 1등
    }));

    const prompt = buildDistillPrompt("Bridgewater Associates", [
      { id: "test-id-1", sourceType: "13f", date: new Date("2026-08-14"), payload: holdings },
    ]);

    expect(prompt).toContain("상위 20건만 표시, 전체 50건 중");
    expect(prompt).toContain("COMPANY 49"); // 최댓값 valueThousands=49는 살아남아야 함
    expect(prompt).not.toContain("COMPANY 0\""); // 최솟값(valueThousands=0)은 잘려나가야 함
  });

  it("배열 payload가 20건 이하면 그대로 전부 포함하고 절단 안내를 남기지 않는다", () => {
    const holdings = Array.from({ length: 5 }, (_, i) => ({ nameOfIssuer: `COMPANY ${i}`, valueThousands: i }));

    const prompt = buildDistillPrompt("Bridgewater Associates", [
      { id: "test-id-1", sourceType: "13f", date: new Date("2026-08-14"), payload: holdings },
    ]);

    expect(prompt).not.toContain("상위");
    expect(prompt).toContain("COMPANY 4");
  });

  it("넷째 요소(배경지식)를 프롬프트에 포함한다", () => {
    const prompt = buildDistillPrompt("Bridgewater Associates", [
      { id: "test-id-1", sourceType: "13f", date: new Date("2026-08-14"), payload: { nameOfIssuer: "APPLE INC" } },
    ]);

    expect(prompt).toContain("배경지식");
    expect(prompt).toContain("넷째");
  });
});
