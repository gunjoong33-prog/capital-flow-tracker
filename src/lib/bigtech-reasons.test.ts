import { describe, it, expect } from "vitest";
import { checkDirectionConsistency } from "./bigtech-reasons";

describe("checkDirectionConsistency", () => {
  it("changePct1d가 null이면 항상 일치로 본다(검증 불가)", () => {
    expect(checkDirectionConsistency(null, "up")).toBe(true);
    expect(checkDirectionConsistency(null, "down")).toBe(true);
  });

  it("실제로 오른 종목인데 원인이 하락 방향이면 불일치", () => {
    expect(checkDirectionConsistency(2.5, "down")).toBe(false);
  });

  it("실제로 내린 종목인데 원인이 상승 방향이면 불일치", () => {
    expect(checkDirectionConsistency(-2.5, "up")).toBe(false);
  });

  it("방향이 실제 등락과 같으면 일치", () => {
    expect(checkDirectionConsistency(2.5, "up")).toBe(true);
    expect(checkDirectionConsistency(-2.5, "down")).toBe(true);
  });

  it("flat 방향은 항상 일치로 본다", () => {
    expect(checkDirectionConsistency(2.5, "flat")).toBe(true);
    expect(checkDirectionConsistency(-2.5, "flat")).toBe(true);
  });

  it("방향 필드가 없으면 검증 안 하고 일치로 본다(LLM이 필드를 안 줬을 때 오탐 방지)", () => {
    expect(checkDirectionConsistency(2.5, undefined)).toBe(true);
  });

  it("0.05%p 이내 미세한 변동은 방향 불문 일치로 본다", () => {
    expect(checkDirectionConsistency(0.02, "down")).toBe(true);
    expect(checkDirectionConsistency(-0.02, "up")).toBe(true);
  });
});
