import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sources/dataroma", () => ({ fetchSuperInvestorActivity: vi.fn(async () => ({ moves: [], errors: [] })) }));
vi.mock("@/lib/sources/openinsider", () => ({ fetchInsiderTrades: vi.fn(async () => ({ trades: [], errors: [] })) }));
vi.mock("@/lib/sources/finra", () => ({
  fetchShortVolumeRatios: vi.fn(async () => ({ rows: new Map(), fileDate: null, errors: [] })),
}));
vi.mock("@/lib/sources/dart", () => ({ fetchEquityDisclosures: vi.fn() }));

import { computeInstitutionalSignals } from "./institutional-signals";
import { fetchEquityDisclosures } from "@/lib/sources/dart";
import type { DartFiling } from "@/lib/sources/dart";

function filing(corpName: string, filerName: string, type: "major" | "insider", stakePctChange: number): DartFiling {
  return { type, corpName, filerName, stakePct: stakePctChange, stakePctChange, rceptDt: "20260807" };
}

describe("computeInstitutionalSignals — 국내 지분공시 요약", () => {
  it("같은 회사가 여러 보고서 타입으로 올라와도 top4를 독점하지 않는다(회사당 1건 캡)", async () => {
    // 2026-08-07 실데이터 재현 — "더테크놀로지"가 대량보유+임원소유 두 필자로 4건 전부 차지했던 사례.
    vi.mocked(fetchEquityDisclosures).mockResolvedValue({
      errors: [],
      filings: [
        filing("더테크놀로지", "엘에스케이엔터테인먼트", "insider", 13.35),
        filing("더테크놀로지", "엘에스케이엔터테인먼트", "major", 13.35),
        filing("더테크놀로지", "엘에스케이무역", "insider", 12.88),
        filing("더테크놀로지", "엘에스케이무역", "major", 12.88),
        filing("서진시스템", "전동규", "major", 1.01),
        filing("한창제지", "시너지아이비투자", "major", 6.09),
        filing("알테오젠", "BlackRockFundAdvisors", "major", 0.05),
      ],
    });

    const { signals } = await computeInstitutionalSignals([], "dart-key");

    const companyMentions = signals.domesticFilingSummary.match(/더테크놀로지/g) ?? [];
    expect(companyMentions).toHaveLength(1);
    expect(signals.domesticFilingSummary).toContain("서진시스템");
    expect(signals.domesticFilingSummary).toContain("한창제지");
  });
});
