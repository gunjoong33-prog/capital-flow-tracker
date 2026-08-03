import { db } from "@/lib/db";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { DateJumpForm } from "@/components/DateJumpForm";
import { getMajorEventsInRange } from "@/lib/major-events";
import { ibmPlexMono, mrsSaintDelafield } from "@/lib/site-fonts";
import type { Step8Result } from "@/lib/scoring/types";
import siteStyles from "@/styles/site.module.css";
import styles from "./page.module.css";

const EVENT_LABEL: Record<string, string> = {
  "FOMC 회의 결과 발표": "FOMC",
  "미국 CPI 발표": "CPI",
  "미국 고용지표 발표": "고용지표",
  "미국 PPI 발표": "PPI",
  "미국 PCE 물가지표 발표": "PCE",
  "일본금융정책결정회의(BOJ 금리 결정)": "BOJ",
};

export const dynamic = "force-dynamic";

const DECISION_CLASS: Record<string, string> = {
  매수: styles["decisionBadge--buy"],
  지켜보기: styles["decisionBadge--watch"],
  현금비중늘리기: styles["decisionBadge--cash"],
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const now = new Date();
  const [year, mon] = (month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`)
    .split("-")
    .map(Number);

  const monthStart = new Date(Date.UTC(year, mon - 1, 1));
  const monthEnd = new Date(Date.UTC(year, mon, 0));
  const gridStart = new Date(monthStart);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());
  const gridEnd = new Date(monthEnd);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()));

  const reports = await db.dailyReport.findMany({
    where: { date: { gte: gridStart, lte: gridEnd } },
    select: { date: true, step8: true },
  });
  const byDate = new Map(reports.map((r) => [toDateKey(r.date), r.step8 as unknown as Step8Result]));

  // 주간 리포트는 일요일 셀에 배지를 달아준다. periodStart(월요일, 일요일 기준 -6일)로 조회하는데
  // 그 월요일이 이번 달 그리드보다 앞설 수 있어(예: 그리드 첫 줄의 일요일) gridStart보다 넓게 잡는다.
  const weekStartRangeBegin = new Date(gridStart);
  weekStartRangeBegin.setUTCDate(weekStartRangeBegin.getUTCDate() - 6);
  const weeklyReports = await db.periodReport.findMany({
    where: { periodType: "week", periodStart: { gte: weekStartRangeBegin, lte: gridEnd } },
    select: { periodStart: true },
  });
  const weeklyReportStarts = new Set(weeklyReports.map((r) => toDateKey(r.periodStart)));

  const majorEvents = await getMajorEventsInRange(gridStart, gridEnd);
  const eventsByDate = new Map<string, string[]>();
  for (const e of majorEvents) {
    const key = toDateKey(e.date);
    const label = EVENT_LABEL[e.name] ?? e.name;
    eventsByDate.set(key, [...(eventsByDate.get(key) ?? []), label]);
  }

  const days: Date[] = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(new Date(d));
  }

  const prevMonth = new Date(Date.UTC(year, mon - 2, 1));
  const nextMonth = new Date(Date.UTC(year, mon, 1));
  const todayKey = toDateKey(now);

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

      <div className={siteStyles.wrap}>
        <div className={styles.topRow}>
          <DateJumpForm defaultYear={now.getUTCFullYear()} defaultMonth={now.getUTCMonth() + 1} defaultDay={now.getUTCDate()} />
        </div>

        <div className={styles.navRow}>
          <Link
            href={`/calendar?month=${prevMonth.getUTCFullYear()}-${String(prevMonth.getUTCMonth() + 1).padStart(2, "0")}`}
            className={styles.navBtn}
          >
            ← 이전달
          </Link>
          <h1 className={styles.navTitle}>{year}년 {mon}월</h1>
          <Link
            href={`/calendar?month=${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}`}
            className={styles.navBtn}
          >
            다음달 →
          </Link>
        </div>

        <div className={styles.grid}>
          {WEEKDAYS.map((w) => (
            <div key={w} className={styles.weekday}>
              {w}
            </div>
          ))}
          {days.map((d) => {
            const key = toDateKey(d);
            const inMonth = d.getUTCMonth() === mon - 1;
            const step8 = byDate.get(key);
            const events = eventsByDate.get(key) ?? [];
            const isToday = key === todayKey;

            // 주간 리포트 배지 — 일요일 셀에서만, 해당 리포트가 실제로 존재할 때만 보여준다.
            const weekStart = new Date(d);
            weekStart.setUTCDate(weekStart.getUTCDate() - 6);
            const weekStartKey = toDateKey(weekStart);
            const hasWeeklyReport = d.getUTCDay() === 0 && weeklyReportStarts.has(weekStartKey);

            const dayContent = (
              <>
                <div className={styles.dayNum}>{d.getUTCDate()}</div>
                {step8 && (
                  <span className={`${styles.decisionBadge} ${DECISION_CLASS[step8.finalDecision] ?? ""}`}>
                    {/* 좁은 모바일 화면(7열 그리드)에서는 "현금비중늘리기 3.6" 같은 긴 텍스트가
                        칸 안에 안 들어가서, 점수만 남기고 결론 텍스트는 데스크톱에서만 보여준다
                        (배지 색으로도 매수/지켜보기/현금비중늘리기 구분은 계속 가능). */}
                    <span className={styles.fullLabel}>{step8.finalDecision} </span>
                    {step8.macroTrendScore.toFixed(1)}
                  </span>
                )}
                {events.length > 0 && (
                  <div className={styles.eventTags}>
                    {events.map((ev, i) => (
                      <span key={i} className={styles.eventTag}>
                        {ev}
                      </span>
                    ))}
                  </div>
                )}
              </>
            );

            // 일요일엔 그 날짜 자체의 DailyReport가 휴장일 스킵으로 없는 경우가 대부분이라(cf.
            // pipeline.ts 휴장일 스킵 로직), 주간 리포트 배지를 daily-report Link 안에 중첩시키면
            // <a> 중첩(무효 HTML)이 될 수 있어 별도 형제 요소로 둔다.
            return (
              <div
                key={key}
                className={`${styles.day} ${inMonth ? "" : styles.isDim} ${isToday ? styles.isToday : ""}`}
              >
                {step8 ? (
                  <Link href={`/calendar/${key}`} className={styles.dayInner}>
                    {dayContent}
                  </Link>
                ) : (
                  <div className={styles.dayInner}>{dayContent}</div>
                )}
                {hasWeeklyReport && (
                  <div className={styles.weeklyTagWrap}>
                    <Link href={`/reports/weekly/${weekStartKey}`} className={styles.weeklyTag}>
                      주간 리포트
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
