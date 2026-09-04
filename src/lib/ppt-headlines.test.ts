import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm-clients", () => ({
  callClaude: vi.fn(),
  extractJsonArray: vi.fn(),
}));

import { callClaude, extractJsonArray } from "@/lib/llm-clients";
import { generatePptHeadlines } from "./ppt-headlines";
import type { PptSlide } from "./scoring/types";

function slide(step: number, kicker: string): PptSlide {
  return { step, kicker, headline: kicker, body: "본문", visual: { type: "none" } };
}

describe("generatePptHeadlines", () => {
  it("정상 응답이면 숫자 없는 헤드라인을 그대로 쓴다", async () => {
    vi.mocked(callClaude).mockResolvedValue("...");
    vi.mocked(extractJsonArray).mockReturnValue([{ step: 1, headline: "숫자보다 뉴스가 이긴 하루" }]);
    const result = await generatePptHeadlines([slide(1, "사실 · 오늘의 결론")]);
    expect(result[1]).toBe("숫자보다 뉴스가 이긴 하루");
  });

  it("헤드라인에 숫자가 섞여 있으면 그 슬라이드만 kicker로 폴백한다", async () => {
    vi.mocked(callClaude).mockResolvedValue("...");
    vi.mocked(extractJsonArray).mockReturnValue([{ step: 1, headline: "148건의 뉴스가 3점을 눌렀다" }]);
    const result = await generatePptHeadlines([slide(1, "사실 · 오늘의 결론")]);
    expect(result[1]).toBe("사실 · 오늘의 결론");
  });

  it("LLM 호출 실패 시 전체 슬라이드가 kicker로 폴백한다", async () => {
    vi.mocked(callClaude).mockRejectedValue(new Error("네트워크 오류"));
    const result = await generatePptHeadlines([slide(1, "사실 · 오늘의 결론"), slide(2, "사실 · 유동성")]);
    expect(result).toEqual({ 1: "사실 · 오늘의 결론", 2: "사실 · 유동성" });
  });

  it("응답 파싱 실패(JSON 배열 아님) 시 전체 슬라이드가 kicker로 폴백한다", async () => {
    vi.mocked(callClaude).mockResolvedValue("이상한 응답");
    vi.mocked(extractJsonArray).mockReturnValue(null);
    const result = await generatePptHeadlines([slide(1, "사실 · 오늘의 결론")]);
    expect(result[1]).toBe("사실 · 오늘의 결론");
  });
});
