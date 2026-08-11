import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Step8Result } from "@/lib/scoring/types";

// ai-macro-company(별도 프로젝트, 별도 DB)의 "성과추적팀" 카드가 이 사이트의 과거 판정을
// 되짚어보는 데 쓰는 공개 읽기 전용 엔드포인트. HTML(/calendar/[date])로 이미 공개된 값 중
// date/marketDate/최종 판정/점수 4개만 노출 — narrative·단계별 상세는 포함하지 않는다.
const DEFAULT_LIMIT = 7;
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
      // 사이트 표시 전체가 .toFixed(2)로 통일돼 있다(반올림 자릿수 일관성) — 이 공개 API도 맞춘다.
      macroTrendScore: Math.round(step8.macroTrendScore * 100) / 100,
    };
  });

  return NextResponse.json({ verdicts });
}
