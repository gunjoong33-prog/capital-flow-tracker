import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBrokerConsensus } from "./broker-consensus";

function htmlResponse(ok: boolean, body: string): Response {
  return { ok, status: 200, text: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchBrokerConsensus", () => {
  it("투자의견·목표주가 컨센서스를 파싱한다", async () => {
    const html = `
      <div class="cop_analysis">
        <em class="coment">투자의견</em>
        <span class="num">4.20매수</span>
        <em class="coment">목표주가</em>
        <span class="num">85,000</span>
      </div>`;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(htmlResponse(true, html))));

    const { consensus, errors } = await fetchBrokerConsensus("005930");

    expect(errors).toEqual([]);
    expect(consensus).toEqual({ opinionScore: 4.2, opinionLabel: "매수", targetPrice: 85000 });
  });

  it("컨센서스 섹션이 없으면 null + 에러", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(htmlResponse(true, "<html></html>"))));

    const { consensus, errors } = await fetchBrokerConsensus("005930");

    expect(consensus).toBeNull();
    expect(errors.length).toBe(1);
  });

  it("HTTP 실패 시 던지지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("") } as Response)));

    const { consensus, errors } = await fetchBrokerConsensus("005930");

    expect(consensus).toBeNull();
    expect(errors[0]).toContain("500");
  });
});
