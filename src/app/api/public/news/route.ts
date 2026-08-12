import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// ai-macro-company(별도 프로젝트, 별도 DB)의 "시장조사팀"(MI)이 뉴스/이벤트 실데이터를
// 가져오는 데 쓰는 공개 읽기 전용 엔드포인트. 새 수집 로직 없음 — 이미 위험도 채점되어
// DB에 저장된 NewsEvent와 /news 페이지용 NewsPageHeadline을 그대로 노출한다(둘 다
// /news·/calendar/[date]에 이미 HTML로 공개된 것과 동일 소스).
const DEFAULT_DAYS = 3;
const MAX_DAYS = 14;
const MAX_HEADLINES_PER_DAY = 10;

export async function GET(request: NextRequest) {
  const daysParam = Number(request.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, MAX_DAYS) : DEFAULT_DAYS;

  const recentDates = await db.newsPageHeadline.findMany({
    distinct: ["date"],
    orderBy: { date: "desc" },
    take: days,
    select: { date: true },
  });

  if (recentDates.length === 0) {
    return NextResponse.json({ riskEvents: [], headlines: [] });
  }

  const dates = recentDates.map((r) => r.date);
  const cutoff = dates[dates.length - 1];

  const [events, headlines] = await Promise.all([
    db.newsEvent.findMany({
      where: { date: { gte: cutoff } },
      orderBy: { date: "desc" },
      select: { date: true, title: true, url: true, summary: true, source: true, priority: true, severity: true },
    }),
    db.newsPageHeadline.findMany({
      where: { date: { in: dates }, rank: { lte: MAX_HEADLINES_PER_DAY } },
      orderBy: [{ date: "desc" }, { rank: "asc" }],
      select: { date: true, category: true, rank: true, title: true, url: true, source: true, publishedAt: true },
    }),
  ]);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return NextResponse.json({
    riskEvents: events.map((e) => ({ ...e, date: fmt(e.date) })),
    headlines: headlines.map((h) => ({
      ...h,
      date: fmt(h.date),
      publishedAt: h.publishedAt ? h.publishedAt.toISOString() : null,
    })),
  });
}
