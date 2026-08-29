import { afterEach, describe, expect, it, vi } from "vitest";
import { extractItemSection, fetchLatest8KExcerpt, fetchBigTech8KExcerpts } from "./sec-filings-text";

function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: () => Promise.resolve(body) } as Response;
}
function textResponse(ok: boolean, body: string): Response {
  return { ok, text: () => Promise.resolve(body) } as Response;
}

// 픽스처는 2026-08-29 실측 AAPL 최신 8-K(aapl-20260730.htm) 본문 구조를 그대로 축약함 —
// 실제 재무 수치가 아니라 "Exhibit 99.1을 보라"는 참조문뿐이라는 걸 실측으로 확인했다.
const AAPL_8K_HTML = `<html><body>
<p>Item 2.02 Results of Operations and Financial Condition. On July 30, 2026, Apple Inc. (&#8220;Apple&#8221;) issued a press release regarding Apple&#8217;s financial results for its third fiscal quarter ended June 27, 2026. A copy of Apple&#8217;s press release is attached hereto as Exhibit 99.1.</p>
<p>Item 9.01 Financial Statements and Exhibits.</p>
</body></html>`;

describe("extractItemSection", () => {
  it("첫 Item 섹션을 발췌한다", () => {
    const section = extractItemSection(AAPL_8K_HTML);

    expect(section).toContain("Item 2.02");
    expect(section).toContain("Exhibit 99.1");
    expect(section).not.toContain("&#8220;"); // 숫자 엔티티가 디코딩돼야 함
  });

  it("Item 섹션이 없으면 null을 반환한다", () => {
    expect(extractItemSection("<html><body>no items here</body></html>")).toBeNull();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchLatest8KExcerpt", () => {
  it("최신 8-K를 찾아 Item 섹션을 발췌해 반환한다", async () => {
    const submissionsBody = {
      filings: {
        recent: {
          form: ["4", "8-K", "10-Q"],
          accessionNumber: ["0000320193-26-000001", "0000320193-26-000123", "0000320193-26-000050"],
          primaryDocument: ["form4.xml", "aapl-20260730.htm", "aapl-10q.htm"],
          filingDate: ["2026-07-29", "2026-07-30", "2026-06-27"],
        },
      },
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("data.sec.gov/submissions")) return Promise.resolve(jsonResponse(true, submissionsBody));
      return Promise.resolve(textResponse(true, AAPL_8K_HTML));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { excerpt, errors } = await fetchLatest8KExcerpt("AAPL");

    expect(errors).toEqual([]);
    expect(excerpt?.filingDate).toBe("2026-07-30");
    expect(excerpt?.excerpt).toContain("Item 2.02");
    expect(excerpt?.url).toContain("aapl-20260730.htm");
  });

  it("모르는 티커는 던지지 않고 errors에 담는다", async () => {
    const { excerpt, errors } = await fetchLatest8KExcerpt("UNKNOWN");

    expect(excerpt).toBeNull();
    expect(errors[0]).toContain("CIK를 모름");
  });

  it("8-K 제출이 없으면 errors에 담는다", async () => {
    const submissionsBody = { filings: { recent: { form: ["10-K"], accessionNumber: ["x"], primaryDocument: ["x.htm"], filingDate: ["2026-01-01"] } } };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(true, submissionsBody))));

    const { excerpt, errors } = await fetchLatest8KExcerpt("AAPL");

    expect(excerpt).toBeNull();
    expect(errors[0]).toContain("최근 8-K 제출 없음");
  });

  it("네트워크 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));

    const { excerpt, errors } = await fetchLatest8KExcerpt("AAPL");

    expect(excerpt).toBeNull();
    expect(errors[0]).toContain("network down");
  });
});

describe("fetchBigTech8KExcerpts", () => {
  it("빅테크7 전체를 순회하며 실패해도 계속 진행한다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));

    const { excerpts, errors } = await fetchBigTech8KExcerpts();

    expect(excerpts).toEqual([]);
    expect(errors.length).toBe(7);
  });
});
