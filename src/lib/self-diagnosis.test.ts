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
    // mockResolvedValueOnce(고정값)로는 인자를 무시하고 항상 같은 결과를 반환하므로 reverse가
    // 있든 없든 테스트가 똑같이 통과해 아무것도 증명하지 못한다. 대신 date -> hit 매핑을 두고,
    // 넘어온 verdicts 배열의 "순서"는 그대로 유지한 채 각 원소에 hit만 채워 돌려준다.
    // detectDivergence는 배열의 "끝"을 최근으로 보고 훑으므로: self-diagnosis.ts가 실제로
    // reverse해서 오름차순(오래된 19~20일 적중 → 최근 21~23일 오적중)으로 넘겼을 때만 배열 끝에
    // 오적중 3건이 와서 연속 실패가 잡힌다. reverse를 빼서 desc 그대로 넘기면 배열 끝에 19~20일
    // (적중)이 와서 연속 실패를 못 잡고 issueDetected가 false로 뒤집힌다.
    const hitByDate = new Map<string, boolean>([
      ["2026-08-19", true],
      ["2026-08-20", true],
      ["2026-08-21", false],
      ["2026-08-22", false],
      ["2026-08-23", false],
    ]);
    vi.mocked(computeVerdictOutcomes).mockImplementationOnce((verdicts) =>
      Promise.resolve(
        verdicts.map((v) => {
          const hit = hitByDate.get(v.date) ?? null;
          return {
            date: v.date,
            marketDate: v.marketDate,
            finalDecision: v.finalDecision,
            sp500ReturnPct: hit === null ? null : hit ? 1 : -1,
            kospiReturnPct: hit === null ? null : hit ? 1 : -1,
            hitSp500: hit,
            hitKospi: hit,
            sp500AnchorDate: null,
            kospiAnchorDate: null,
          };
        })
      )
    );

    const result = await runSelfDiagnosis();

    expect(result.issueDetected).toBe(true);
    expect(result.issueDescription).toContain("연속");
  });
});
