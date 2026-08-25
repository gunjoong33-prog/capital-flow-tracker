import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRecommendationTrend } from "./finnhub";

function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, status: 200, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchRecommendationTrend", () => {
  it("최신 월 등급분포를 반환한다", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "test-key");
    const body = [
      { period: "2026-08-01", strongBuy: 10, buy: 8, hold: 5, sell: 1, strongSell: 0 },
      { period: "2026-07-01", strongBuy: 9, buy: 8, hold: 6, sell: 1, strongSell: 0 },
    ];
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(true, body))));

    const { trend, errors } = await fetchRecommendationTrend("AAPL");

    expect(errors).toEqual([]);
    expect(trend).toEqual({ period: "2026-08-01", strongBuy: 10, buy: 8, hold: 5, sell: 1, strongSell: 0 });
  });

  it("API 키 없으면 호출 안 하고 에러로 안내한다", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { trend, errors } = await fetchRecommendationTrend("AAPL");

    expect(trend).toBeNull();
    expect(errors[0]).toContain("FINNHUB_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("빈 배열 응답이면 trend null + 에러", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(true, []))));

    const { trend, errors } = await fetchRecommendationTrend("AAPL");

    expect(trend).toBeNull();
    expect(errors.length).toBe(1);
  });
});
