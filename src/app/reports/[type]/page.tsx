import { db } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import type { PeriodType } from "@/lib/period-report";

export const dynamic = "force-dynamic";

const TYPE_MAP: Record<string, PeriodType> = {
  weekly: "week", monthly: "month", quarterly: "quarter", yearly: "year",
};
const LABEL: Record<string, string> = {
  weekly: "주간", monthly: "월간", quarterly: "분기", yearly: "연간",
};
const DECISION_COLOR: Record<string, string> = {
  매수: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  지켜보기: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  현금비중늘리기: "bg-rose-500/15 text-rose-400 border-rose-500/30",
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
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto max-w-3xl space-y-6">
        <SiteNav active="reports" />

        <div className="flex gap-2 text-sm">
          {Object.keys(TYPE_MAP).map((t) => (
            <Link
              key={t}
              href={`/reports/${t}`}
              className={`rounded-md border px-3 py-1.5 ${t === type ? "border-zinc-500 bg-zinc-900 text-zinc-100" : "border-zinc-800 text-zinc-500 hover:bg-zinc-900"}`}
            >
              {LABEL[t]}
            </Link>
          ))}
        </div>

        <h1 className="text-lg font-medium">{LABEL[type]} 자본 흐름 리포트 아카이브</h1>

        {reports.length === 0 && (
          <p className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 text-sm text-zinc-500">
            아직 마감된 {LABEL[type]} 리포트가 없다. 해당 주기가 끝나는 날 자동으로 생성된다.
          </p>
        )}

        <div className="space-y-3">
          {reports.map((r) => {
            const startKey = r.periodStart.toISOString().slice(0, 10);
            const summary = r.summary as { avgMacroTrendScore: number | null; decisionCounts: Record<string, number> };
            const topDecision = Object.entries(summary.decisionCounts ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
            return (
              <Link
                key={r.id}
                href={`/reports/${type}/${startKey}`}
                className="block rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 hover:bg-zinc-900"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-300">
                    {startKey} ~ {r.periodEnd.toISOString().slice(0, 10)}
                  </span>
                  <div className="flex items-center gap-2">
                    {topDecision && (
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${DECISION_COLOR[topDecision] ?? ""}`}>
                        {topDecision}
                      </span>
                    )}
                    {summary.avgMacroTrendScore !== null && (
                      <span className="text-xs text-zinc-500">평균 투자 적합도 {summary.avgMacroTrendScore}</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
