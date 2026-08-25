import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHedgeFundHoldings, TRACKED_HEDGE_FUNDS } from "./sec-13f";

function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: () => Promise.resolve(body) } as Response;
}
function textResponse(ok: boolean, body: string): Response {
  return { ok, text: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TRACKED_HEDGE_FUNDS", () => {
  it("최소 1개 이상의 추적 대상 헤지펀드를 갖는다", () => {
    expect(TRACKED_HEDGE_FUNDS.length).toBeGreaterThan(0);
    expect(TRACKED_HEDGE_FUNDS[0]).toHaveProperty("cik");
  });
});

describe("fetchHedgeFundHoldings", () => {
  it("최신 13F 제출을 찾아 보유내역을 파싱해 반환한다", async () => {
    const submissionsBody = {
      filings: {
        recent: {
          form: ["13F-HR", "10-K"],
          accessionNumber: ["0001234567-26-000123", "0009999999-26-000001"],
          primaryDocument: ["primary_doc.xml", "other.xml"],
          filingDate: ["2026-08-14", "2026-03-01"],
        },
      },
    };
    const infoTableXml = `<?xml version="1.0"?>
<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <infoTable>
    <nameOfIssuer>APPLE INC</nameOfIssuer>
    <cusip>037833100</cusip>
    <value>150000</value>
    <shrsOrPrnAmt><sshPrnamt>1000</sshPrnamt></shrsOrPrnAmt>
  </infoTable>
  <infoTable>
    <nameOfIssuer>MICROSOFT CORP</nameOfIssuer>
    <cusip>594918104</cusip>
    <value>200000</value>
    <shrsOrPrnAmt><sshPrnamt>500</sshPrnamt></shrsOrPrnAmt>
  </infoTable>
</informationTable>`;

    const fetchMock = vi.fn((url: string) => {
      if (url.includes("data.sec.gov/submissions")) return Promise.resolve(jsonResponse(true, submissionsBody));
      return Promise.resolve(textResponse(true, infoTableXml));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { holdings, filingDate, errors } = await fetchHedgeFundHoldings("0001350694");

    expect(errors).toEqual([]);
    expect(filingDate).toBe("2026-08-14");
    expect(holdings).toEqual([
      { nameOfIssuer: "APPLE INC", cusip: "037833100", valueThousands: 150000, shares: 1000 },
      { nameOfIssuer: "MICROSOFT CORP", cusip: "594918104", valueThousands: 200000, shares: 500 },
    ]);
  });

  it("13F-HR 제출이 하나도 없으면 빈 배열과 에러를 반환한다", async () => {
    const submissionsBody = { filings: { recent: { form: ["10-K"], accessionNumber: ["x"], primaryDocument: ["x.xml"], filingDate: ["2026-01-01"] } } };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(true, submissionsBody))));

    const { holdings, filingDate, errors } = await fetchHedgeFundHoldings("0001350694");

    expect(holdings).toEqual([]);
    expect(filingDate).toBeNull();
    expect(errors.length).toBe(1);
  });

  it("네트워크 실패 시 던지지 않고 errors에 담아 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));

    const { holdings, errors } = await fetchHedgeFundHoldings("0001350694");

    expect(holdings).toEqual([]);
    expect(errors[0]).toContain("network down");
  });
});
