import { db } from "@/lib/db";
import Link from "next/link";
import type { Step8Result } from "@/lib/scoring/types";

export const dynamic = "force-dynamic";

const DECISION_COLOR: Record<string, string> = {
  매수: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  지켜보기: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  현금비중늘리기: "bg-rose-500/15 text-rose-400 border-rose-500/30",
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

  const days: Date[] = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(new Date(d));
  }

  const prevMonth = new Date(Date.UTC(year, mon - 2, 1));
  const nextMonth = new Date(Date.UTC(year, mon, 1));
  const todayKey = toDateKey(now);

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto max-w-4xl space-y-6">
        <nav className="flex gap-4 text-sm text-zinc-500">
          <Link href="/" className="hover:text-zinc-200">오늘의 리포트</Link>
          <span className="text-zinc-100">캘린더</span>
          <Link href="/reports/weekly" className="hover:text-zinc-200">주기별 리포트</Link>
        </nav>

        <div className="flex items-center justify-between">
          <Link
            href={`/calendar?month=${prevMonth.getUTCFullYear()}-${String(prevMonth.getUTCMonth() + 1).padStart(2, "0")}`}
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900"
          >
            ← 이전달
          </Link>
          <h1 className="text-lg font-medium">{year}년 {mon}월</h1>
          <Link
            href={`/calendar?month=${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}`}
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900"
          >
            다음달 →
          </Link>
        </div>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800">
          {WEEKDAYS.map((w) => (
            <div key={w} className="bg-zinc-900 py-2 text-center text-xs text-zinc-500">
              {w}
            </div>
          ))}
          {days.map((d) => {
            const key = toDateKey(d);
            const inMonth = d.getUTCMonth() === mon - 1;
            const step8 = byDate.get(key);
            const isToday = key === todayKey;
            const cell = (
              <div
                className={`min-h-24 bg-zinc-950 p-2 ${inMonth ? "" : "opacity-30"} ${isToday ? "ring-1 ring-inset ring-zinc-500" : ""}`}
              >
                <div className="text-xs text-zinc-500">{d.getUTCDate()}</div>
                {step8 && (
                  <span
                    className={`mt-1 inline-block rounded-full border px-1.5 py-0.5 text-[10px] ${DECISION_COLOR[step8.finalDecision] ?? ""}`}
                  >
                    {step8.finalDecision} {step8.macroTrendScore.toFixed(1)}
                  </span>
                )}
              </div>
            );
            return step8 ? (
              <Link key={key} href={`/calendar/${key}`} className="block hover:bg-zinc-900/60">
                {cell}
              </Link>
            ) : (
              <div key={key}>{cell}</div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
