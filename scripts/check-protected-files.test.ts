// scripts/check-protected-files.test.ts
import { describe, expect, it } from "vitest";
import { checkProtectedFiles } from "./check-protected-files";

describe("checkProtectedFiles", () => {
  it("보호 파일이 없으면 ok: true", () => {
    expect(checkProtectedFiles(["src/lib/narrative.ts"])).toEqual({ ok: true, violated: [] });
  });

  it("보호 파일이 섞여 있으면 ok: false + 위반 목록", () => {
    const result = checkProtectedFiles(["src/lib/narrative.ts", "src/lib/scoring/run.ts"]);
    expect(result.ok).toBe(false);
    expect(result.violated).toEqual(["src/lib/scoring/run.ts"]);
  });
});
