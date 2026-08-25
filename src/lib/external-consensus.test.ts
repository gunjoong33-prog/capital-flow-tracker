import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { externalConsensus: { create: vi.fn().mockResolvedValue({}) } } }));
vi.mock("@/lib/sources/sec-13f", () => ({
  TRACKED_HEDGE_FUNDS: [{ name: "Bridgewater Associates", cik: "0001350694" }],
  fetchHedgeFundHoldings: vi.fn().mockResolvedValue({ holdings: [{ nameOfIssuer: "APPLE INC", cusip: "x", valueThousands: 1, shares: 1 }], filingDate: "2026-08-14", errors: [] }),
}));
vi.mock("@/lib/sources/bis", () => ({
  fetchPolicyRates: vi.fn().mockResolvedValue({ rates: [{ area: "US", period: "2026-08", ratePct: 4.5 }], errors: [] }),
}));
vi.mock("@/lib/sources/finnhub", () => ({
  fetchRecommendationTrend: vi.fn().mockResolvedValue({ trend: { period: "2026-08-01", strongBuy: 1, buy: 1, hold: 1, sell: 0, strongSell: 0 }, errors: [] }),
}));
vi.mock("@/lib/sources/broker-consensus", () => ({
  fetchBrokerConsensus: vi.fn().mockResolvedValue({ consensus: { opinionScore: 4, opinionLabel: "매수", targetPrice: 1000 }, errors: [] }),
}));

import { collectExternalConsensus } from "./external-consensus";
import { db } from "@/lib/db";

describe("collectExternalConsensus", () => {
  it("4개 소스를 전부 조회해 DB에 저장하고 저장 건수를 반환한다", async () => {
    const { saved, errors } = await collectExternalConsensus(["AAPL"]);

    expect(errors).toEqual([]);
    expect(saved).toBe(4); // 13F 1건 + BIS 1건 + Finnhub 1건 + 국내컨센서스 1건
    expect(db.externalConsensus.create).toHaveBeenCalledTimes(4);
  });
});
