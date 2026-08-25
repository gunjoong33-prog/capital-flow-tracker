import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPolicyRates } from "./bis";

function textResponse(ok: boolean, body: string): Response {
  return { ok, status: 200, text: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPolicyRates", () => {
  it("CSV를 국가별 정책금리 배열로 파싱한다", async () => {
    const csv = `REF_AREA,TIME_PERIOD,OBS_VALUE\nUS,2026-08,4.50\nXM,2026-08,2.75\nJP,2026-08,0.50\n`;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(textResponse(true, csv))));

    const { rates, errors } = await fetchPolicyRates();

    expect(errors).toEqual([]);
    expect(rates).toEqual([
      { area: "US", period: "2026-08", ratePct: 4.5 },
      { area: "XM", period: "2026-08", ratePct: 2.75 },
      { area: "JP", period: "2026-08", ratePct: 0.5 },
    ]);
  });

  it("빈 CSV(헤더만)면 빈 배열과 에러를 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(textResponse(true, "REF_AREA,TIME_PERIOD,OBS_VALUE\n"))));

    const { rates, errors } = await fetchPolicyRates();

    expect(rates).toEqual([]);
    expect(errors.length).toBe(1);
  });

  it("HTTP 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve("") } as Response)));

    const { rates, errors } = await fetchPolicyRates();

    expect(rates).toEqual([]);
    expect(errors[0]).toContain("503");
  });
});
