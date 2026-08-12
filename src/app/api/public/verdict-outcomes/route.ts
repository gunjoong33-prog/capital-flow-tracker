import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Step8Result } from "@/lib/scoring/types";
import { computeVerdictOutcomes, aggregateHitRate } from "@/lib/verdict-outcomes";

// ai-macro-company(별도 프로젝트, 별도 DB)의 "성과추적팀"(PR)이 적중률을 실제로 계산해 가져가는
// 공개 읽기 전용 엔드포인트. /api/public/verdicts와 같은 판정 데이터를, 발행 시점 이후 실제
// S&P500·KOSPI 가격 변화와 코드가 대조해 적중 여부까지 채점한 뒤 내려준다 — LLM은 이 숫자를
// 서술만 하고 스스로 "적중"을 판단하지 않는다.
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 90;

export async function GET(request: NextRequest) {
  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

  const reports = await db.dailyReport.findMany({
    orderBy: { date: "desc" },
    take: limit,
    select: { date: true, marketDate: true, step8: true },
  });

  const verdicts = reports.map((report) => {
    const step8 = report.step8 as unknown as Step8Result;
    return {
      date: report.date.toISOString().slice(0, 10),
      marketDate: report.marketDate ? report.marketDate.toISOString().slice(0, 10) : null,
      finalDecision: step8.finalDecision,
    };
  });

  const outcomes = await computeVerdictOutcomes(verdicts);

  return NextResponse.json({
    outcomes,
    hitRateSp500: aggregateHitRate(outcomes, "hitSp500"),
    hitRateKospi: aggregateHitRate(outcomes, "hitKospi"),
  });
}
