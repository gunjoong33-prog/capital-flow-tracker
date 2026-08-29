import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWorldBankReports } from "./world-bank";

// 픽스처는 2026-08-29 실측 search.worldbank.org/api/v3/wds 응답 구조를 그대로 축약함.
const WDS_BODY = {
  rows: 2,
  os: 0,
  page: 1,
  total: 173,
  documents: {
    D40072400: {
      id: "40072400",
      docdt: "2025-11-15T05:00:00Z",
      display_title: "The World Bank's MFMod Framework in Python with Modelflow",
      pdfurl: "https://documents.worldbank.org/curated/en/099120125152010503/pdf/P507959-14dd767e-09b8-4e99-9246-d9c4993823eb.pdf",
    },
    D40028208: {
      id: "40028208",
      docdt: "2025-06-30T04:00:00Z",
      display_title: "Fourteenth Global Debt Report",
      pdfurl: "https://documents.worldbank.org/curated/en/099120125152010504/pdf/example.pdf",
    },
  },
  facets: {},
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWorldBankReports", () => {
  it("경제분석 리포트 목록을 파싱해 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(WDS_BODY) } as Response)));

    const { reports, errors } = await fetchWorldBankReports();

    expect(errors).toEqual([]);
    expect(reports).toHaveLength(2);
    expect(reports[0].title).toContain("MFMod");
    expect(reports[0].url).toContain(".pdf");
  });

  it("HTTP 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)));

    const { reports, errors } = await fetchWorldBankReports();

    expect(reports).toEqual([]);
    expect(errors[0]).toContain("World Bank WDS 조회 실패");
  });

  it("문서 0건이면 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ documents: {} }) } as Response)));

    const { reports, errors } = await fetchWorldBankReports();

    expect(reports).toEqual([]);
    expect(errors.length).toBe(1);
  });
});
