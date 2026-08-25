import { describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { learningNote: { findMany } } }));

import { fetchRecentLearningContext } from "./narrative-learning-context";

describe("fetchRecentLearningContext", () => {
  it("LearningNote가 없으면 undefined를 반환한다", async () => {
    findMany.mockResolvedValueOnce([]);

    const result = await fetchRecentLearningContext();

    expect(result).toBeUndefined();
  });

  it("LearningNote가 있으면 category/sourceName/summary를 사람이 읽을 문자열로 합쳐 반환한다", async () => {
    findMany.mockResolvedValueOnce([
      { category: "헤지펀드", sourceName: "Bridgewater Associates", summary: "정책금리 방향을 최우선으로 본다." },
      { category: "은행", sourceName: "BIS", summary: "정책금리 인하 사이클이 이어지고 있다." },
    ]);

    const result = await fetchRecentLearningContext();

    expect(result).toContain("Bridgewater Associates");
    expect(result).toContain("정책금리 방향을 최우선으로 본다");
    expect(result).toContain("BIS");
  });
});
