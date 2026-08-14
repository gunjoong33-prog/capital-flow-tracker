import { describe, it, expect } from "vitest";
import { buildEventOutcomeHeadlines, buildInstitutionalHeadlines } from "./news-market-events";
import type { InstitutionalSignals } from "./institutional-signals";

describe("buildInstitutionalHeadlines", () => {
  const signals: InstitutionalSignals = {
    superInvestorSummary: "헤더:\n항목A",
    stockConsensusSummary: "헤더:\n항목B",
    sectorFlowSummary: "한줄요약",
    insiderTradeSummary: "확인 못함",
    shortVolumeSummary: "확인 못함",
    domesticFilingSummary: "확인 못함",
    activityTickers: [],
    topSectorLabel: null,
  };

  it("같은 baseUrl(Dataroma)을 쓰는 항목끼리도 url이 전부 유니크하다", () => {
    // 실측 버그: url이 겹치면 DB createMany의 skipDuplicates가 항목을 조용히 버린다.
    const headlines = buildInstitutionalHeadlines(signals, new Date("2026-08-14T00:00:00Z"));
    const urls = headlines.map((h) => h.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("확인 못함인 항목은 헤드라인을 안 만든다", () => {
    const headlines = buildInstitutionalHeadlines(signals, new Date("2026-08-14T00:00:00Z"));
    expect(headlines.some((h) => h.source === "FINRA")).toBe(false);
    expect(headlines.some((h) => h.source === "OpenInsider")).toBe(false);
  });

  it("헤더+첫 항목을 한 줄로 압축한다", () => {
    const headlines = buildInstitutionalHeadlines(signals, new Date("2026-08-14T00:00:00Z"));
    const superInvestor = headlines.find((h) => h.source === "Dataroma(슈퍼투자자)");
    expect(superInvestor?.title).toBe("헤더 — 항목A");
  });

  it("이미 한 줄인 요약(sectorFlowSummary)은 그대로 쓴다", () => {
    const headlines = buildInstitutionalHeadlines(signals, new Date("2026-08-14T00:00:00Z"));
    const sectorFlow = headlines.find((h) => h.source.includes("자금흐름"));
    expect(sectorFlow?.title).toBe("한줄요약");
  });
});

describe("buildEventOutcomeHeadlines", () => {
  const outcomes = [
    { name: "미국 CPI 발표", date: "2026-08-14", detail: "YoY 3.36%", subLabel: "(헤드라인)" },
    { name: "미국 CPI 발표", date: "2026-08-14", detail: "YoY 2.48%", subLabel: "(근원)" },
    { name: "미국 PPI 발표", date: "2026-08-10", detail: "YoY 4.69%" }, // 오늘 아님 — 제외돼야 함
    { name: "FOMC", date: "2026-08-14", detail: "5.00~5.25%로 동결" },
  ];

  it("오늘(todayStr) 날짜인 이벤트만 헤드라인으로 만든다", () => {
    const headlines = buildEventOutcomeHeadlines(outcomes, "2026-08-14");
    expect(headlines).toHaveLength(3);
    expect(headlines.every((h) => h.title.includes("2026-08-10"))).toBe(false);
  });

  it("FOMC는 중앙은행, 나머지는 경제 발표로 분류한다", () => {
    const headlines = buildEventOutcomeHeadlines(outcomes, "2026-08-14");
    expect(headlines.find((h) => h.title.includes("FOMC"))?.category).toBe("central-bank");
    expect(headlines.filter((h) => h.title.includes("CPI")).every((h) => h.category === "econ-release")).toBe(true);
  });
});
