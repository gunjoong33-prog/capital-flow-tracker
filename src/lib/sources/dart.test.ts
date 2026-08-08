import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEquityDisclosures } from "./dart";

function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchEquityDisclosures", () => {
  it("목록을 받아 대량보유·임원소유 상세를 매칭해 반환한다", async () => {
    const listBody = {
      status: "000",
      message: "정상",
      list: [
        { corp_code: "00838005", corp_name: "서진시스템", report_nm: "주식등의대량보유상황보고서(일반)", rcept_no: "R1", flr_nm: "전동규", rcept_dt: "20260807" },
        { corp_code: "01408999", corp_name: "웨이버스", report_nm: "임원ㆍ주요주주특정증권등소유상황보고서", rcept_no: "R2", flr_nm: "조문기", rcept_dt: "20260807" },
      ],
    };
    const majorstockBody = { status: "000", list: [{ rcept_no: "R1", stkrt: "48.81", stkrt_irds: "1.36" }] };
    const elestockBody = { status: "000", list: [{ rcept_no: "R2", sp_stock_lmp_rate: "2.53", sp_stock_lmp_irds_rate: "-0.06" }] };

    const fetchMock = vi.fn((url: string) => {
      if (url.includes("list.json")) return Promise.resolve(jsonResponse(true, listBody));
      if (url.includes("majorstock.json")) return Promise.resolve(jsonResponse(true, majorstockBody));
      return Promise.resolve(jsonResponse(true, elestockBody));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { filings, errors } = await fetchEquityDisclosures("key", new Date("2026-08-07"));

    expect(errors).toEqual([]);
    expect(filings).toHaveLength(2);
    expect(filings.find((f) => f.type === "major")).toMatchObject({ corpName: "서진시스템", stakePct: 48.81, stakePctChange: 1.36 });
    expect(filings.find((f) => f.type === "insider")).toMatchObject({ corpName: "웨이버스", stakePct: 2.53, stakePctChange: -0.06 });
  });

  it("공시 없는 날(status 013)은 에러 없이 빈 배열을 반환한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true, { status: "013", message: "조회된 데이터가 없습니다." }));
    vi.stubGlobal("fetch", fetchMock);

    const { filings, errors } = await fetchEquityDisclosures("key", new Date("2026-08-09"));

    expect(filings).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("목록 조회 자체가 실패하면 에러를 기록하고 빈 배열을 반환한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(false, {}));
    vi.stubGlobal("fetch", fetchMock);

    const { filings, errors } = await fetchEquityDisclosures("bad-key", new Date("2026-08-07"));

    expect(filings).toEqual([]);
    expect(errors.length).toBe(1);
  });
});
