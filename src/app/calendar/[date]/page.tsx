import { db } from "@/lib/db";
import { ReportView, type ReportViewData } from "@/components/ReportView";
import { SiteHeader } from "@/components/SiteHeader";
import { ibmPlexMono, mrsSaintDelafield } from "@/lib/site-fonts";
import type { StepDetails } from "@/lib/scoring/types";
import { notFound } from "next/navigation";
import siteStyles from "@/styles/site.module.css";

export const dynamic = "force-dynamic";

export default async function CalendarDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const report = await db.dailyReport.findUnique({ where: { date: new Date(date) } });
  if (!report) notFound();

  const dateOnlyLabel = new Date(date).toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "UTC",
  });
  // marketDate(실제 데이터 기준 미국장 마감 거래일)가 리포트 생성일과 다르면(휴장일 등) 병기 —
  // "8/1 리포트인데 실제로는 7/31 데이터"처럼 두 날짜가 섞여 혼동되는 걸 막는다(외부 감사 지적).
  const marketDateLabel = report.marketDate?.toISOString().slice(0, 10);
  const dateLabel = marketDateLabel && marketDateLabel !== date ? `${dateOnlyLabel} · 기준: ${marketDateLabel} 미국장 마감` : dateOnlyLabel;

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
    <div
      className={`${siteStyles.page} ${ibmPlexMono.variable} ${mrsSaintDelafield.variable}`}
      style={{
        ["--font-gothic" as string]: "'Gothic A1', sans-serif",
        ["--font-sans" as string]: "'IBM Plex Sans KR', sans-serif",
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@500;700;800&family=IBM+Plex+Sans+KR:wght@400;600&display=swap"
      />
      <SiteHeader current="calendar" />
      <div className={siteStyles.wrap} style={{ maxWidth: "52rem", paddingBlock: "1.6rem 3rem" }}>
        <ReportView
          dateLabel={dateLabel}
          report={reportData}
          details={report.details as unknown as StepDetails | null}
        />
      </div>
    </div>
  );
}
