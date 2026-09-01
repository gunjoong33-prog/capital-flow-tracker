import { describe, expect, it, vi } from "vitest";

// 8건(MIN_SAMPLE) 이상, 실제 쿼리(orderBy: date desc)와 같은 최신순 — 전부 오적중이라
// 어떤 순서로 들어와도(reverse 여부와 무관하게) 신뢰구간 상한이 50% 밑으로 떨어진다.
// 예전 버전(3연속 실패 기준)은 배열의 "끝"이 최근인지 여부에 트리거가 갈렸지만, 지금은
// 표본 전체의 적중률로 판단하므로 순서 자체가 정답을 좌우하지 않는다 — self-diagnosis.ts의
// reverse()는 이제 트리거 정확성이 아니라 detail 메시지의 날짜 범위 표기 순서를 위한 것이다.
// vi.mock 팩토리는 파일 맨 위로 호이스팅되므로, 참조할 데이터는 vi.hoisted()로 같이 끌어올린다.
const { DESC_MOCK_REPORTS } = vi.hoisted(() => ({
  DESC_MOCK_REPORTS: Array.from({ length: 8 }, (_, i) => ({
    date: new Date(`2026-08-${23 - i}`),
    marketDate: new Date(`2026-08-${23 - i}`),
    step8: { finalDecision: "매수" },
  })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    autoFixLog: { count: vi.fn().mockResolvedValue(0) },
    dailyReport: { findMany: vi.fn().mockResolvedValue(DESC_MOCK_REPORTS) },
  },
}));
vi.mock("@/lib/verdict-outcomes", () => ({
  computeVerdictOutcomes: vi.fn().mockImplementation((verdicts: { date: string }[]) =>
    Promise.resolve(
      verdicts.map((v) => ({
        date: v.date,
        marketDate: v.date,
        finalDecision: "매수",
        hitSp500: false,
        hitKospi: false,
        sp500ReturnPct: -1,
        kospiReturnPct: -1,
        sp500AnchorDate: null,
        kospiAnchorDate: null,
      }))
    )
  ),
}));

import { runSelfDiagnosis } from "./self-diagnosis";
import { db } from "@/lib/db";

describe("runSelfDiagnosis", () => {
  it("표본 8건 이상이 통계적으로 유의하게 저조하면 이상 발견으로 보고한다", async () => {
    const result = await runSelfDiagnosis();

    expect(result.issueDetected).toBe(true);
    expect(result.issueDescription).toContain("적중");
  });

  it("오늘 이미 자동배포 1건이 있으면 이상이 있어도 issueDetected는 false로 보고한다(상한 가드)", async () => {
    vi.mocked(db.autoFixLog.count).mockResolvedValueOnce(1);

    const result = await runSelfDiagnosis();

    expect(result.issueDetected).toBe(false);
  });

  it("같은 detectedIssue 문자열로 오늘 이미 AutoFixLog가 있으면 배포 상한과 무관하게 issueDetected는 false다", async () => {
    // 첫 count 호출(배포 상한)은 0(상한 미도달), 두 번째 count 호출(같은 이슈 오늘 존재 여부)은 1.
    vi.mocked(db.autoFixLog.count).mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const result = await runSelfDiagnosis();

    expect(result.issueDetected).toBe(false);
    expect(result.issueDescription).toBeNull();
  });
});
