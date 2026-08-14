import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCronAuth } from "@/lib/cron-auth";
import { kstToday } from "@/lib/date";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

// cron-job.org가 /api/cron/daily(매일 08:50 KST) 이후 시각(예: 09:10 KST)에 호출.
// 두 가지를 감지한다: (1) 오늘 리포트가 아예 없음 — 데일리 크론이 안 돌았거나 도중에 실패,
// (2) 리포트는 있지만 sendReportUploadedAlert가 실패해 sourceErrors에 "Discord알림" 항목이
// 남아있음 — 리포트 자체는 정상 생성됐는데 업로드 알림만 조용히 못 간 경우.
export const dynamic = "force-dynamic";

type SourceError = { source: string; error: string };

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const today = kstToday();
  const report = await db.dailyReport.findUnique({ where: { date: new Date(today) } });

  if (!report) {
    await sendHealthCheckAlert(`오늘(${today}) 데일리 리포트가 아직 생성되지 않음 — 크론(/api/cron/daily)이 안 돌았거나 실패한 것으로 보임`);
    return NextResponse.json({ ok: false, issue: "report-missing" });
  }

  const sourceErrors = ((report.dataCompleteness as { sourceErrors?: SourceError[] } | null)?.sourceErrors ?? []) as SourceError[];
  const alertError = sourceErrors.find((e) => e.source === "Discord알림");

  if (alertError) {
    await sendHealthCheckAlert(`오늘(${today}) 리포트는 생성됐지만 업로드 알림 전송에 실패함: ${alertError.error}`);
    return NextResponse.json({ ok: false, issue: "alert-failed", detail: alertError.error });
  }

  return NextResponse.json({ ok: true, issue: null });
}
