import { describe, it, expect } from "vitest";
import { checkDirectionConsistency, buildConsistentReasons } from "./bigtech-direction";

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

describe("buildConsistentReasons", () => {
  it("direction이 실제 등락과 일치하면 원문 reason을 그대로 반환한다", () => {
    const parsed = [{ ticker: "AAPL", reason: "실적 호조로 상승했습니다.", direction: "up" as const }];
    const changes = [{ ticker: "AAPL", changePct1d: 2.5 }];
    expect(buildConsistentReasons(parsed, changes)).toEqual({ AAPL: "실적 호조로 상승했습니다." });
  });

  it("direction이 실제 등락과 모순되면 접미사 없는 정확한 대체 문구로 바꾼다(run.ts exact-match 회귀 테스트)", () => {
    const parsed = [{ ticker: "MSFT", reason: "목표주가 상향으로 상승했습니다.", direction: "up" as const }];
    const changes = [{ ticker: "MSFT", changePct1d: -3.1 }];
    expect(buildConsistentReasons(parsed, changes)).toEqual({ MSFT: "명확한 원인 확인 안 됨" });
  });

  it("changePct1d가 null(검증 불가)이면 원문 reason을 그대로 반환한다", () => {
    const parsed = [{ ticker: "TSLA", reason: "관련 뉴스로 변동했습니다.", direction: "down" as const }];
    const changes = [{ ticker: "TSLA", changePct1d: null }];
    expect(buildConsistentReasons(parsed, changes)).toEqual({ TSLA: "관련 뉴스로 변동했습니다." });
  });

  it("여러 티커를 한 번에 처리할 때 각자의 changePct1d와 매칭한다(Map 조회 오매칭 방지)", () => {
    const parsed = [
      { ticker: "AAPL", reason: "AAPL 이유", direction: "up" as const },
      { ticker: "MSFT", reason: "MSFT 이유", direction: "up" as const },
      { ticker: "GOOG", reason: "GOOG 이유", direction: "down" as const },
    ];
    const changes = [
      { ticker: "AAPL", changePct1d: 1.5 }, // up과 일치
      { ticker: "MSFT", changePct1d: -1.5 }, // up과 불일치
      { ticker: "GOOG", changePct1d: -1.5 }, // down과 일치
    ];
    expect(buildConsistentReasons(parsed, changes)).toEqual({
      AAPL: "AAPL 이유",
      MSFT: "명확한 원인 확인 안 됨",
      GOOG: "GOOG 이유",
    });
  });
});
