import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { StepDetails } from "@/lib/scoring/types";

// ai-macro-company(별도 프로젝트, 별도 DB)의 "기업분석팀"(EQ)이 기관·내부자 매집/국내
// 지분공시(DART)/공매도 실데이터를 가져오는 데 쓰는 공개 읽기 전용 엔드포인트.
// /api/public/verdicts와 같은 패턴(인증 없음, limit 캡, 최소 필드) — 이미 계산·저장된
// DailyReport.details.step7Institutional(Dataroma·OpenInsider·FINRA·DART·KRX 요약)만
// 노출한다. 새 계산·수집 로직 없음 — KRX/DART 원본 자격증명은 여기서도 재사용하지 않는다.
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 30;

export async function GET(request: NextRequest) {
  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

  const reports = await db.dailyReport.findMany({
    orderBy: { date: "desc" },
    take: limit,
    select: { date: true, marketDate: true, details: true },
  });

  const days = reports.map((report) => {
    const details = report.details as unknown as StepDetails | null;
    return {
      date: report.date.toISOString().slice(0, 10),
      marketDate: report.marketDate ? report.marketDate.toISOString().slice(0, 10) : null,
      institutional: details?.step7Institutional ?? [],
    };
  });

  return NextResponse.json({ days });
}
