import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { StepDetails } from "@/lib/scoring/types";

// ai-macro-company(별도 프로젝트, 별도 DB)의 "거시경제분석팀"(MC)이 유동성·캐리트레이드·
// 환율·금·유가 실데이터를 가져오는 데 쓰는 공개 읽기 전용 엔드포인트. /api/public/verdicts와
// 같은 패턴(인증 없음, limit 캡, 최소 필드) — 이미 계산·저장된 DailyReport의 2~4단계
// (유동성/캐리트레이드/환율금유가)만 골라 노출한다. 새 계산 로직 없음.
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 30;

export async function GET(request: NextRequest) {
  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

  const reports = await db.dailyReport.findMany({
    orderBy: { date: "desc" },
    take: limit,
    select: { date: true, marketDate: true, step2: true, step3: true, step4: true, details: true },
  });

  const days = reports.map((report) => {
    const details = report.details as unknown as StepDetails | null;
    return {
      date: report.date.toISOString().slice(0, 10),
      marketDate: report.marketDate ? report.marketDate.toISOString().slice(0, 10) : null,
      liquidity: { result: report.step2, summary: details?.step2Summary ?? null, indicators: details?.step2 ?? [], aux: details?.step2Aux ?? [] },
      carryTrade: { result: report.step3, summary: details?.step3Summary ?? null },
      fxGoldOil: { result: report.step4, summary: details?.step4Summary ?? null, indicators: details?.step4 ?? [], aux: details?.step4Aux ?? [] },
    };
  });

  return NextResponse.json({ days });
}
