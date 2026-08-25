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

  it("desc 정렬로 온 배열(최신이 먼저)에서 실제 최근 연속 실패를 정확히 감지한다(reverse 검증)", async () => {
    // findMany는 실제 쿼리(orderBy: date desc)와 동일하게 최신이 배열 맨 앞에 오도록 반환.
    // 가장 오래된 2건은 적중, 가장 최근 3건은 오적중 — reverse 없이 그대로 넘기면
    // detectDivergence가 거꾸로 훑어서 이 최근 연속 실패를 못 잡는다.
    vi.mocked(db.dailyReport.findMany).mockResolvedValueOnce([
      { date: new Date("2026-08-23"), marketDate: new Date("2026-08-23"), step8: { finalDecision: "매수" } },
      { date: new Date("2026-08-22"), marketDate: new Date("2026-08-22"), step8: { finalDecision: "매수" } },
      { date: new Date("2026-08-21"), marketDate: new Date("2026-08-21"), step8: { finalDecision: "매수" } },
      { date: new Date("2026-08-20"), marketDate: new Date("2026-08-20"), step8: { finalDecision: "매수" } },
      { date: new Date("2026-08-19"), marketDate: new Date("2026-08-19"), step8: { finalDecision: "매수" } },
    ] as never);
    const { computeVerdictOutcomes } = await import("@/lib/verdict-outcomes");
    vi.mocked(computeVerdictOutcomes).mockResolvedValueOnce([
      // computeVerdictOutcomes는 넘어온 순서를 그대로 유지 — self-diagnosis.ts가 reverse해서
      // 넘기면 여기도 오름차순(오래된 것부터)으로 들어온다.
      { date: "2026-08-19", marketDate: "2026-08-19", finalDecision: "매수", hitSp500: true, hitKospi: true, sp500ReturnPct: 1, kospiReturnPct: 1, sp500AnchorDate: null, kospiAnchorDate: null },
      { date: "2026-08-20", marketDate: "2026-08-20", finalDecision: "매수", hitSp500: true, hitKospi: true, sp500ReturnPct: 1, kospiReturnPct: 1, sp500AnchorDate: null, kospiAnchorDate: null },
      { date: "2026-08-21", marketDate: "2026-08-21", finalDecision: "매수", hitSp500: false, hitKospi: false, sp500ReturnPct: -1, kospiReturnPct: -1, sp500AnchorDate: null, kospiAnchorDate: null },
      { date: "2026-08-22", marketDate: "2026-08-22", finalDecision: "매수", hitSp500: false, hitKospi: false, sp500ReturnPct: -1, kospiReturnPct: -1, sp500AnchorDate: null, kospiAnchorDate: null },
      { date: "2026-08-23", marketDate: "2026-08-23", finalDecision: "매수", hitSp500: false, hitKospi: false, sp500ReturnPct: -1, kospiReturnPct: -1, sp500AnchorDate: null, kospiAnchorDate: null },
    ]);

    const result = await runSelfDiagnosis();

    expect(result.issueDetected).toBe(true);
    expect(result.issueDescription).toContain("연속");
  });
});
