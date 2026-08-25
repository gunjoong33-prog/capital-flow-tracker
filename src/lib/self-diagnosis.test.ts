import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    autoFixLog: { count: vi.fn().mockResolvedValue(0) },
    dailyReport: { findMany: vi.fn().mockResolvedValue([
      { date: new Date("2026-08-20"), marketDate: new Date("2026-08-20"), step8: { finalDecision: "매수" } },
      { date: new Date("2026-08-21"), marketDate: new Date("2026-08-21"), step8: { finalDecision: "매수" } },
      { date: new Date("2026-08-22"), marketDate: new Date("2026-08-22"), step8: { finalDecision: "매수" } },
      { date: new Date("2026-08-23"), marketDate: new Date("2026-08-23"), step8: { finalDecision: "매수" } },
    ]) },
  },
}));
vi.mock("@/lib/verdict-outcomes", () => ({
  computeVerdictOutcomes: vi.fn().mockResolvedValue([
    { date: "2026-08-20", marketDate: "2026-08-20", finalDecision: "매수", hitSp500: false, hitKospi: false, sp500ReturnPct: -1, kospiReturnPct: -1, sp500AnchorDate: null, kospiAnchorDate: null },
    { date: "2026-08-21", marketDate: "2026-08-21", finalDecision: "매수", hitSp500: false, hitKospi: false, sp500ReturnPct: -1, kospiReturnPct: -1, sp500AnchorDate: null, kospiAnchorDate: null },
    { date: "2026-08-22", marketDate: "2026-08-22", finalDecision: "매수", hitSp500: false, hitKospi: false, sp500ReturnPct: -1, kospiReturnPct: -1, sp500AnchorDate: null, kospiAnchorDate: null },
    { date: "2026-08-23", marketDate: "2026-08-23", finalDecision: "매수", hitSp500: false, hitKospi: false, sp500ReturnPct: -1, kospiReturnPct: -1, sp500AnchorDate: null, kospiAnchorDate: null },
  ]),
}));

import { runSelfDiagnosis } from "./self-diagnosis";
import { db } from "@/lib/db";

describe("runSelfDiagnosis", () => {
  it("연속 오적중 패턴이 있으면 이상 발견으로 보고한다", async () => {
    const result = await runSelfDiagnosis();

    expect(result.issueDetected).toBe(true);
    expect(result.issueDescription).toContain("연속");
  });

  it("오늘 이미 자동배포 1건이 있으면 이상이 있어도 issueDetected는 false로 보고한다(상한 가드)", async () => {
    vi.mocked(db.autoFixLog.count).mockResolvedValueOnce(1);

    const result = await runSelfDiagnosis();

    expect(result.issueDetected).toBe(false);
  });
});
