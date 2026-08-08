import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchKrxShortBalanceSummary } from "./krx-short";

function fakeResponse(opts: { text?: string; json?: unknown; setCookies?: string[] }): Response {
  const headers = {
    getSetCookie: () => opts.setCookies ?? [],
    get: (name: string) => (name.toLowerCase() === "set-cookie" ? (opts.setCookies?.[0] ?? null) : null),
  };
  return {
    headers,
    text: () => Promise.resolve(opts.text ?? JSON.stringify(opts.json ?? {})),
    json: () => Promise.resolve(opts.json ?? {}),
  } as unknown as Response;
}

const SAMPLE_ROWS = [
  { ISU_CD: "005930", ISU_ABBRV: "삼성전자", BAL_QTY: "1,000", LIST_SHRS: "100,000", BAL_AMT: "1,000,000", MKTCAP: "100,000,000", BAL_RTO: "0.10" },
  { ISU_CD: "000660", ISU_ABBRV: "SK하이닉스", BAL_QTY: "2,000", LIST_SHRS: "50,000", BAL_AMT: "5,000,000", MKTCAP: "50,000,000", BAL_RTO: "4.00" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchKrxShortBalanceSummary", () => {
  it("로그인 성공 후 시가총액가중 평균과 상위 5종목을 계산한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ text: "" })) // warmup1
      .mockResolvedValueOnce(fakeResponse({ text: "" })) // warmup2
      .mockResolvedValueOnce(fakeResponse({ json: { _error_code: "CD001" } })) // login
      .mockResolvedValueOnce(fakeResponse({ json: { OutBlock_1: SAMPLE_ROWS } })); // data
    vi.stubGlobal("fetch", fetchMock);

    const summary = await fetchKrxShortBalanceSummary("id", "pw", new Date("2026-08-07"));

    expect(summary).not.toBeNull();
    expect(summary!.date).toBe("2026-08-07");
    // (1,000,000 + 5,000,000) / (100,000,000 + 50,000,000) * 100
    expect(summary!.marketWeightedRatio).toBeCloseTo(4.0, 5);
    expect(summary!.top5[0].name).toBe("SK하이닉스");
  });

  it("CD011(중복 로그인)이면 skipDup으로 재시도한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ text: "" }))
      .mockResolvedValueOnce(fakeResponse({ text: "" }))
      .mockResolvedValueOnce(fakeResponse({ json: { _error_code: "CD011" } })) // 최초 로그인 시도
      .mockResolvedValueOnce(fakeResponse({ json: { _error_code: "CD001" } })) // skipDup 재시도
      .mockResolvedValueOnce(fakeResponse({ json: { OutBlock_1: SAMPLE_ROWS } }));
    vi.stubGlobal("fetch", fetchMock);

    const summary = await fetchKrxShortBalanceSummary("id", "pw", new Date("2026-08-07"));

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(summary).not.toBeNull();
  });

  it("로그인 실패면 에러를 던진다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ text: "" }))
      .mockResolvedValueOnce(fakeResponse({ text: "" }))
      .mockResolvedValueOnce(fakeResponse({ json: { _error_code: "CD002", _error_message: "비밀번호 오류" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchKrxShortBalanceSummary("id", "wrong-pw", new Date("2026-08-07"))).rejects.toThrow("KRX 로그인 실패");
  });

  it("데이터가 계속 비어있으면(휴장일 등) null을 반환한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ text: "" }))
      .mockResolvedValueOnce(fakeResponse({ text: "" }))
      .mockResolvedValueOnce(fakeResponse({ json: { _error_code: "CD001" } }))
      .mockResolvedValue(fakeResponse({ json: { OutBlock_1: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    const summary = await fetchKrxShortBalanceSummary("id", "pw", new Date("2026-08-07"), 3);

    expect(summary).toBeNull();
  });
});
