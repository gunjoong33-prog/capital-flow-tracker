import { db } from "@/lib/db";

/**
 * 오늘자 자동 파이프라인(크론)이 실행됐는지 확인한다. /report·홈은 항상 최신 DB 값으로 실시간
 * 계산되지만(force-dynamic), 계산에 쓰이는 원자료 자체가 "어제 값"일 수 있다 — 크론이 실패하면
 * 화면은 멀쩡해 보여도(냉장고 불은 켜져 있지만 냉각기는 꺼진 상태) 사실은 갱신이 멈춘 것이다.
 * 오늘 날짜의 DailyReport row 존재 여부를 그 대리 신호로 쓴다.
 */
export interface ReportFreshness {
  hasTodayReport: boolean;
  todayStr: string;
  lastReportDate: string | null;
  hoursSinceLastReport: number | null;
}

export async function checkReportFreshness(): Promise<ReportFreshness> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [today, latest] = await Promise.all([
    db.dailyReport.findUnique({ where: { date: new Date(todayStr) }, select: { createdAt: true } }),
    db.dailyReport.findFirst({ orderBy: { date: "desc" }, select: { date: true, createdAt: true } }),
  ]);

  if (today) {
    return { hasTodayReport: true, todayStr, lastReportDate: todayStr, hoursSinceLastReport: 0 };
  }
  if (!latest) {
    return { hasTodayReport: false, todayStr, lastReportDate: null, hoursSinceLastReport: null };
  }
  const hours = (Date.now() - latest.createdAt.getTime()) / (1000 * 60 * 60);
  return {
    hasTodayReport: false,
    todayStr,
    lastReportDate: latest.date.toISOString().slice(0, 10),
    hoursSinceLastReport: Math.round(hours),
  };
}
