import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { generateNarrative } from "@/lib/narrative";
import type { Step8Result } from "@/lib/scoring/types";

export type PeriodType = "week" | "month" | "quarter" | "year";

const PERIOD_LABEL: Record<PeriodType, string> = {
  week: "주간", month: "월간", quarter: "분기", year: "연간",
};

const TREND_METRICS = ["WALCL", "M2", "SPX", "NDX", "BTC", "USDKRW", "GOLD", "VIX", "US10Y", "JP10Y"];

function utc(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d));
}

export function getPeriodBounds(type: PeriodType, ref: Date): { start: Date; end: Date } {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const d = ref.getUTCDate();

  if (type === "week") {
    const start = utc(y, m, d - ref.getUTCDay());
    const end = utc(y, m, d - ref.getUTCDay() + 6);
    return { start, end };
  }
  if (type === "month") {
    return { start: utc(y, m, 1), end: utc(y, m + 1, 0) };
  }
  if (type === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    return { start: utc(y, qStartMonth, 1), end: utc(y, qStartMonth + 3, 0) };
  }
  return { start: utc(y, 0, 1), end: utc(y, 11, 31) };
}

/** 오늘이 해당 주기의 마지막 날인지(그날 배치를 돌려야 하는지) 판정. */
export function isPeriodEnd(type: PeriodType, date: Date): boolean {
  const { end } = getPeriodBounds(type, date);
  return date.getUTCFullYear() === end.getUTCFullYear() &&
    date.getUTCMonth() === end.getUTCMonth() &&
    date.getUTCDate() === end.getUTCDate();
}

async function metricChangePct(metric: string, start: Date, end: Date): Promise<number | null> {
  const [first, last] = await Promise.all([
    db.metricValue.findFirst({ where: { metric, date: { gte: start, lte: end } }, orderBy: { date: "asc" } }),
    db.metricValue.findFirst({ where: { metric, date: { gte: start, lte: end } }, orderBy: { date: "desc" } }),
  ]);
  if (!first || !last || first.value === 0) return null;
  return Number((((last.value - first.value) / Math.abs(first.value)) * 100).toFixed(2));
}

export async function aggregatePeriod(type: PeriodType, ref: Date) {
  const { start, end } = getPeriodBounds(type, ref);

  const dailyReports = await db.dailyReport.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
    select: { date: true, step8: true },
  });

  const scores = dailyReports.map((r) => (r.step8 as unknown as Step8Result).macroTrendScore);
  const decisions = dailyReports.map((r) => (r.step8 as unknown as Step8Result).finalDecision);
  const decisionCounts = decisions.reduce<Record<string, number>>((acc, d) => {
    acc[d] = (acc[d] ?? 0) + 1;
    return acc;
  }, {});

  const metricChanges: Record<string, number | null> = {};
  for (const metric of TREND_METRICS) {
    metricChanges[metric] = await metricChangePct(metric, start, end);
  }

  return {
    periodType: type,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    daysWithData: dailyReports.length,
    avgMacroTrendScore: scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null,
    firstScore: scores[0] ?? null,
    lastScore: scores[scores.length - 1] ?? null,
    decisionCounts,
    metricChangesPct: metricChanges,
  };
}

function buildPeriodNarrativePrompt(summary: Awaited<ReturnType<typeof aggregatePeriod>>): string {
  return `너는 매크로 자본흐름 애널리스트다. 아래는 ${PERIOD_LABEL[summary.periodType]} 기간(${summary.start} ~ ${summary.end}) 동안 집계된 데이터다.
이 숫자만 근거로 3~5문장짜리 한국어 해설을 써라. 이 기간 동안 자본이 어느 쪽으로 흘렀는지(위험자산/안전자산, 유동성 확장/축소 등)에 집중해라.
규칙:
- 집계 JSON에 없는 숫자나 사실을 지어내지 마라. 데이터가 부족하면(daysWithData가 적으면) 그렇다고 명시해라.
- 과장하지 말고 담백하게 써라. 존댓말 아닌 평서체로.

집계 JSON:
${JSON.stringify(summary, null, 2)}`;
}

export async function generateAndSavePeriodReport(type: PeriodType, ref: Date) {
  const summary = await aggregatePeriod(type, ref);
  let narrative: string;
  try {
    narrative = await generateNarrative(buildPeriodNarrativePrompt(summary));
  } catch (err) {
    narrative = `[해설 생성 실패: ${err instanceof Error ? err.message : String(err)}]`;
  }

  const { start, end } = getPeriodBounds(type, ref);
  await db.periodReport.upsert({
    where: { periodType_periodStart: { periodType: type, periodStart: start } },
    create: { periodType: type, periodStart: start, periodEnd: end, summary: summary as unknown as Prisma.InputJsonValue, narrative },
    update: { periodEnd: end, summary: summary as unknown as Prisma.InputJsonValue, narrative },
  });

  return summary;
}

/** 오늘 날짜 기준으로 마감되는 모든 주기(주/월/분기/년)를 검사해 필요한 것만 생성한다. */
export async function generatePeriodReportsIfDue(today: Date) {
  const results: { type: PeriodType; generated: boolean }[] = [];
  for (const type of ["week", "month", "quarter", "year"] as PeriodType[]) {
    if (isPeriodEnd(type, today)) {
      await generateAndSavePeriodReport(type, today);
      results.push({ type, generated: true });
    } else {
      results.push({ type, generated: false });
    }
  }
  return results;
}
