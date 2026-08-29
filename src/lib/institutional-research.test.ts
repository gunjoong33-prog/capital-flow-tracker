import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { externalConsensus: { upsert: vi.fn().mockResolvedValue({}) } } }));
vi.mock("@/lib/obsidian-export", () => ({ upsertObsidianFile: vi.fn().mockResolvedValue({ status: "created" }) }));
vi.mock("@/lib/sources/naver-research", () => ({
  fetchNaverResearch: vi.fn().mockResolvedValue({
    items: [{ stockName: "SK텔레콤", title: "시너지 효과", broker: "미래에셋증권", pdfUrl: "https://x.pdf", date: "26.08.28" }],
    errors: [],
  }),
}));
vi.mock("@/lib/sources/sec-filings-text", () => ({
  fetchBigTech8KExcerpts: vi.fn().mockResolvedValue({
    excerpts: [{ ticker: "AAPL", filingDate: "2026-08-28", url: "https://sec.gov/x.htm", excerpt: "Item 2.02 ..." }],
    errors: [],
  }),
}));
vi.mock("@/lib/sources/fed-releases", () => ({
  fetchFedReleases: vi.fn().mockResolvedValue({ releases: [{ title: "Fed release", url: "https://fed.gov/x", publishedAt: null, kind: "press" }], errors: [] }),
}));
vi.mock("@/lib/sources/ecb-publications", () => ({
  fetchEcbPublications: vi.fn().mockResolvedValue({ publications: [{ title: "ECB release", url: "https://ecb.eu/x", publishedAt: null }], errors: [] }),
}));
vi.mock("@/lib/sources/world-bank", () => ({
  fetchWorldBankReports: vi.fn().mockResolvedValue({ reports: [{ title: "WB report", url: "https://wb.org/x.pdf", publishedAt: "2026-08-01" }], errors: [] }),
}));
vi.mock("@/lib/sources/pimco", () => ({
  fetchPimcoOutlooks: vi.fn().mockResolvedValue({ outlooks: [{ label: "Secular Outlook", url: "https://pimco.com/x" }], errors: [] }),
}));
vi.mock("@/lib/sources/blackrock", () => ({
  fetchBlackrockCommentary: vi.fn().mockResolvedValue({ commentary: { title: "Weekly: x", url: "https://blackrock.com/x" }, errors: [] }),
}));

import { collectInstitutionalResearch, buildInstitutionalResearchMarkdown, collectAndExportInstitutionalResearch } from "./institutional-research";
import { db } from "@/lib/db";
import { upsertObsidianFile } from "@/lib/obsidian-export";

describe("collectInstitutionalResearch", () => {
  it("7개 소스를 전부 조회해 DB에 저장하고 항목 목록을 반환한다", async () => {
    const { saved, items, errors } = await collectInstitutionalResearch();

    expect(errors).toEqual([]);
    expect(saved).toBe(7);
    expect(items).toHaveLength(7);
    expect(db.externalConsensus.upsert).toHaveBeenCalledTimes(7);
  });
});

describe("buildInstitutionalResearchMarkdown", () => {
  it("소스별로 그룹핑한 마크다운을 만든다", () => {
    const md = buildInstitutionalResearchMarkdown("2026-08-29", [
      { sourceType: "fed", sourceName: "a", title: "Fed news", url: "https://fed.gov/a" },
      { sourceType: "pimco", sourceName: "b", title: "PIMCO Secular Outlook", url: "https://pimco.com/b" },
    ]);

    expect(md).toContain("# 2026-08-29 오늘의 기관 리서치 원문");
    expect(md).toContain("## 미 연준(Fed)");
    expect(md).toContain("[Fed news](https://fed.gov/a)");
    expect(md).toContain("## PIMCO");
  });

  it("항목이 없으면 안내 문구만 넣는다", () => {
    const md = buildInstitutionalResearchMarkdown("2026-08-29", []);

    expect(md).toContain("수집된 항목이 없습니다");
  });
});

describe("collectAndExportInstitutionalResearch", () => {
  it("GITHUB_EXPORT_TOKEN이 있으면 옵시디언에 커밋한다", async () => {
    process.env.GITHUB_EXPORT_TOKEN = "test-token";

    const { saved, errors } = await collectAndExportInstitutionalResearch();

    expect(saved).toBe(7);
    expect(errors).toEqual([]);
    expect(upsertObsidianFile).toHaveBeenCalledWith(
      expect.stringContaining("obsidian-export/학습/기관 리서치/"),
      expect.stringContaining("오늘의 기관 리서치 원문"),
      "test-token"
    );

    delete process.env.GITHUB_EXPORT_TOKEN;
  });

  it("GITHUB_EXPORT_TOKEN이 없으면 DB 저장만 하고 옵시디언은 건너뛴다", async () => {
    delete process.env.GITHUB_EXPORT_TOKEN;
    vi.mocked(upsertObsidianFile).mockClear();

    const { saved } = await collectAndExportInstitutionalResearch();

    expect(saved).toBe(7);
    expect(upsertObsidianFile).not.toHaveBeenCalled();
  });
});
