import { db } from "@/lib/db";
import { ReportView, type ReportViewData } from "@/components/ReportView";
import type { StepDetails } from "@/lib/scoring/types";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CalendarDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const report = await db.dailyReport.findUnique({ where: { date: new Date(date) } });
  if (!report) notFound();

  const dateLabel = new Date(date).toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "UTC",
  });

  const reportData: ReportViewData = {
    step1: report.step1 as unknown as ReportViewData["step1"],
    step2: report.step2 as unknown as ReportViewData["step2"],
    step3: report.step3 as unknown as ReportViewData["step3"],
    step4: report.step4 as unknown as ReportViewData["step4"],
    step5: report.step5 as unknown as ReportViewData["step5"],
    step6: report.step6 as unknown as ReportViewData["step6"],
    step7: report.step7 as unknown as ReportViewData["step7"],
    step8: report.step8 as unknown as ReportViewData["step8"],
  };

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto max-w-3xl space-y-4">
        <nav className="flex gap-4 text-sm text-zinc-500">
          <Link href="/" className="hover:text-zinc-200">오늘의 리포트</Link>
          <Link href="/calendar" className="hover:text-zinc-200">캘린더</Link>
          <Link href="/reports/weekly" className="hover:text-zinc-200">주기별 리포트</Link>
        </nav>
        <ReportView
          dateLabel={dateLabel}
          report={reportData}
          narrative={report.narrative}
          details={report.details as unknown as StepDetails | null}
        />
      </main>
    </div>
  );
}
