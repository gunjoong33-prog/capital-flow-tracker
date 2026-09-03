import { describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { weeklyLearningSynthesis: { findFirst } } }));

import { fetchRecentLearningContext } from "./narrative-learning-context";

describe("fetchRecentLearningContext", () => {
  it("압축본이 없으면 undefined를 반환한다", async () => {
    findFirst.mockResolvedValueOnce(null);

    const result = await fetchRecentLearningContext();

    expect(result).toBeUndefined();
  });

  it("압축본이 있으면 content를 그대로 반환한다", async () => {
    findFirst.mockResolvedValueOnce({
      periodKey: "2026-W36",
      content: "이번 주 여러 기관은 조건부 서술을 선호했다.",
    });

    const result = await fetchRecentLearningContext();

    expect(result).toBe("이번 주 여러 기관은 조건부 서술을 선호했다.");
  });
});
