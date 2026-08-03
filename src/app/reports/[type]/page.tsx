import { db } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { ibmPlexMono, mrsSaintDelafield } from "@/lib/site-fonts";
import type { PeriodType } from "@/lib/period-report";
import siteStyles from "@/styles/site.module.css";
import styles from "../reports.module.css";

export const dynamic = "force-dynamic";

const TYPE_MAP: Record<string, PeriodType> = {
  weekly: "week", monthly: "month", quarterly: "quarter", yearly: "year",
};
const LABEL: Record<string, string> = {
  weekly: "주간", monthly: "월간", quarterly: "분기", yearly: "연간",
};
const DECISION_CLASS: Record<string, string> = {
  매수: siteStyles["pill--buy"],
  지켜보기: siteStyles["pill--watch"],
  현금비중늘리기: siteStyles["pill--cash"],
};

export default async function ReportArchivePage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const periodType = TYPE_MAP[type];
  if (!periodType) notFound();

  const reports = await db.periodReport.findMany({
    where: { periodType },
    orderBy: { periodStart: "desc" },
  });

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
      <SiteHeader current="reports" />

      <div className={siteStyles.wrap}>
        <nav className={styles.tabs}>
          {Object.keys(TYPE_MAP).map((t) => (
            <Link key={t} href={`/reports/${t}`} className={`${styles.tab} ${t === type ? styles.tabActive : ""}`}>
              {LABEL[t]}
            </Link>
          ))}
        </nav>

        <h1 className={styles.pageTitle}>{LABEL[type]} 자본 흐름 리포트 아카이브</h1>

        {reports.length === 0 && (
          <p className={styles.empty}>
            아직 마감된 {LABEL[type]} 리포트가 없다. 해당 주기가 끝난 다음 주기 첫날(예: 주간은 일요일, 월간은 매월 1일)에 자동으로 생성된다.
          </p>
        )}

        <div className={styles.list}>
          {reports.map((r) => {
            const startKey = r.periodStart.toISOString().slice(0, 10);
            const summary = r.summary as { avgMacroTrendScore: number | null; decisionCounts: Record<string, number> };
            const topDecision = Object.entries(summary.decisionCounts ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
            return (
              <Link key={r.id} href={`/reports/${type}/${startKey}`} className={styles.item}>
                <span className={styles.item__range}>
                  {startKey} ~ {r.periodEnd.toISOString().slice(0, 10)}
                </span>
                <span className={styles.item__right}>
                  {topDecision && (
                    <span className={`${siteStyles.pill} ${DECISION_CLASS[topDecision] ?? ""}`}>{topDecision}</span>
                  )}
                  {summary.avgMacroTrendScore !== null && (
                    <span className={styles.item__score}>평균 투자 적합도 {summary.avgMacroTrendScore}</span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
