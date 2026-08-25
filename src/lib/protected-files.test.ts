import { describe, expect, it } from "vitest";
import { PROTECTED_FILES, touchesProtectedFile } from "./protected-files";

describe("touchesProtectedFile", () => {
  it("보호 목록의 정확한 경로를 건드리면 true", () => {
    expect(touchesProtectedFile(["src/lib/scoring/run.ts"])).toBe(true);
  });

  it("보호 목록에 없는 경로만 건드리면 false", () => {
    expect(touchesProtectedFile(["src/lib/narrative.ts", "src/app/page.tsx"])).toBe(false);
  });

  it("보호 파일 하나라도 섞여 있으면 true(여러 파일 중 하나만 걸려도 차단)", () => {
    expect(touchesProtectedFile(["src/lib/narrative.ts", "src/lib/scoring/pure.ts"])).toBe(true);
  });

  it("PROTECTED_FILES는 run.ts·pipeline.ts·pure.ts·types.ts를 포함한다", () => {
    expect(PROTECTED_FILES).toContain("src/lib/scoring/run.ts");
    expect(PROTECTED_FILES).toContain("src/lib/pipeline.ts");
    expect(PROTECTED_FILES).toContain("src/lib/scoring/pure.ts");
    expect(PROTECTED_FILES).toContain("src/lib/scoring/types.ts");
  });
});
