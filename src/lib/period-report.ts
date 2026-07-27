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

/**
 * 각 주기 리포트를 실행해야 하는 "실시일"인지 판정 — 주기가 끝난 다음날(=다음 주기 첫날)에 실행한다.
 * week: 매주 일요일(월~토 6일을 종합) / month: 매월 1일(지난달 종합)
 * quarter: 매분기 첫날(지난 분기 종합) / year: 매년 1월 1일(작년 종합)
 */
export function isReportDay(type: PeriodType, date: Date): boolean {
  if (type === "week") return date.getUTCDay() === 0;
  if (type === "month") return date.getUTCDate() === 1;
  if (type === "quarter") return date.getUTCDate() === 1 && date.getUTCMonth() % 3 === 0;
  return date.getUTCMonth() === 0 && date.getUTCDate() === 1;
}

/** 실시일(reportDate) 기준으로 방금 끝난 직전 주기의 [start, end]를 계산한다. */
export function getPrecedingPeriodBounds(type: PeriodType, reportDate: Date): { start: Date; end: Date } {
  const y = reportDate.getUTCFullYear();
  const m = reportDate.getUTCMonth();
  const d = reportDate.getUTCDate();

  if (type === "week") {
    // reportDate = 일요일. 직전 월~토(6일).
    return { start: utc(y, m, d - 6), end: utc(y, m, d - 1) };
  }
  if (type === "month") {
    // reportDate = 매월 1일. 지난달 전체(JS Date가 음수 달을 자동으로 이전 해로 넘겨준다).
    return { start: utc(y, m - 1, 1), end: utc(y, m, 0) };
  }
  if (type === "quarter") {
    // reportDate = 분기 첫날. 지난 분기 전체(3개월).
    return { start: utc(y, m - 3, 1), end: utc(y, m, 0) };
  }
  // year: reportDate = 1월 1일. 작년 전체.
  return { start: utc(y - 1, 0, 1), end: utc(y - 1, 11, 31) };
}

interface ChildPeriodRef {
  type: PeriodType;
  start: string;
  end: string;
  avgMacroTrendScore: number | null;
}

interface AggregatedBase {
  daysWithData: number;
  avgMacroTrendScore: number | null;
  firstScore: number | null;
  lastScore: number | null;
  decisionCounts: Record<string, number>;
  childPeriods?: ChildPeriodRef[];
}

async function metricChangePct(metric: string, start: Date, end: Date): Promise<number | null> {
  const [first, last] = await Promise.all([
    db.metricValue.findFirst({ where: { metric, date: { gte: start, lte: end } }, orderBy: { date: "asc" } }),
    db.metricValue.findFirst({ where: { metric, date: { gte: start, lte: end } }, orderBy: { date: "desc" } }),
  ]);
  if (!first || !last || first.value === 0) return null;
  return Number((((last.value - first.value) / Math.abs(first.value)) * 100).toFixed(2));
}

/** 주간 리포트 전용 — DailyReport를 직접 집계한다(더 작은 하위 주기가 없으므로). */
async function aggregateFromDaily(start: Date, end: Date): Promise<AggregatedBase> {
  const dailyReports = await db.dailyReport.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
    select: { date: true, step8: true },
  });

  const scores = dailyReports.map((r) => (r.step8 as unknown as Step8Result).macroTrendScore);
  const decisions = dailyReports.map((r) => (r.step8 as unknown as Step8Result).finalDecision);
  const decisionCounts = decisions.reduce<Record<string, number>>((acc, dcn) => {
    acc[dcn] = (acc[dcn] ?? 0) + 1;
    return acc;
  }, {});

  return {
    daysWithData: dailyReports.length,
    avgMacroTrendScore: scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null,
    firstScore: scores[0] ?? null,
    lastScore: scores[scores.length - 1] ?? null,
    decisionCounts,
  };
}

/** 월/분기/연간 리포트 전용 — 하위 주기 리포트(childType)들을 종합한다(일별 재계산 아님). */
async function aggregateFromChildren(childType: PeriodType, start: Date, end: Date): Promise<AggregatedBase> {
  const children = await db.periodReport.findMany({
    where: { periodType: childType, periodStart: { gte: start, lte: end } },
    orderBy: { periodStart: "asc" },
  });

  const childSummaries = children.map(
    (c) =>
      c.summary as unknown as {
        daysWithData: number;
        avgMacroTrendScore: number | null;
        firstScore: number | null;
        lastScore: number | null;
        decisionCounts: Record<string, number>;
      }
  );

  const daysWithData = childSummaries.reduce((a, c) => a + c.daysWithData, 0);
  const scoreVals = childSummaries.map((c) => c.avgMacroTrendScore).filter((v): v is number => v !== null);
  const avgMacroTrendScore = scoreVals.length ? Number((scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length).toFixed(2)) : null;

  const decisionCounts: Record<string, number> = {};
  for (const c of childSummaries) {
    for (const [dcn, cnt] of Object.entries(c.decisionCounts ?? {})) {
      decisionCounts[dcn] = (decisionCounts[dcn] ?? 0) + cnt;
    }
  }

  const firstScore = childSummaries.find((c) => c.firstScore !== null)?.firstScore ?? null;
  const lastScore = [...childSummaries].reverse().find((c) => c.lastScore !== null)?.lastScore ?? null;

  const childPeriods: ChildPeriodRef[] = children.map((c, i) => ({
    type: childType,
    start: c.periodStart.toISOString().slice(0, 10),
    end: c.periodEnd.toISOString().slice(0, 10),
    avgMacroTrendScore: childSummaries[i]?.avgMacroTrendScore ?? null,
  }));

  return { daysWithData, avgMacroTrendScore, firstScore, lastScore, decisionCounts, childPeriods };
}

export async function aggregatePeriod(type: PeriodType, reportDate: Date) {
  const { start, end } = getPrecedingPeriodBounds(type, reportDate);

  let base: AggregatedBase;
  if (type === "week") {
    base = await aggregateFromDaily(start, end);
  } else if (type === "month") {
    base = await aggregateFromChildren("week", start, end);
  } else if (type === "quarter") {
    base = await aggregateFromChildren("month", start, end);
  } else {
    // year — 월간 12개를 집계 기준으로 삼고(중복 계산 방지), 분기 4개는 참고용으로만 덧붙인다.
    base = await aggregateFromChildren("month", start, end);
    const quarters = await db.periodReport.findMany({
      where: { periodType: "quarter", periodStart: { gte: start, lte: end } },
      orderBy: { periodStart: "asc" },
    });
    const quarterRefs: ChildPeriodRef[] = quarters.map((q) => ({
      type: "quarter",
      start: q.periodStart.toISOString().slice(0, 10),
      end: q.periodEnd.toISOString().slice(0, 10),
      avgMacroTrendScore: (q.summary as unknown as { avgMacroTrendScore: number | null } | null)?.avgMacroTrendScore ?? null,
    }));
    base = { ...base, childPeriods: [...(base.childPeriods ?? []), ...quarterRefs] };
  }

  const metricChanges: Record<string, number | null> = {};
  for (const metric of TREND_METRICS) {
    metricChanges[metric] = await metricChangePct(metric, start, end);
  }

  return {
    periodType: type,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    ...base,
    metricChangesPct: metricChanges,
  };
}

function buildPeriodNarrativePrompt(summary: Awaited<ReturnType<typeof aggregatePeriod>>): string {
  const childNote = summary.childPeriods?.length
    ? `\n이 집계는 하위 주기 리포트 ${summary.childPeriods.length}건(${summary.childPeriods
        .map((c) => `${c.start}~${c.end}: 평균 ${c.avgMacroTrendScore ?? "확인 못함"}`)
        .join(", ")})을 종합한 것이다.`
    : "";
  return `너는 매크로 자본흐름 애널리스트다. 아래는 ${PERIOD_LABEL[summary.periodType]} 기간(${summary.start} ~ ${summary.end}) 동안 집계된 데이터다.${childNote}
이 숫자만 근거로 3~5문장짜리 한국어 해설을 써라. 이 기간 동안 자본이 어느 쪽으로 흘렀는지(위험자산/안전자산, 유동성 확장/축소 등)에 집중해라.
규칙:
- 집계 JSON에 없는 숫자나 사실을 지어내지 마라. 데이터가 부족하면(daysWithData가 적으면) 그렇다고 명시해라.
- 과장하지 말고 담백하게 써라. 존댓말 아닌 평서체로.

집계 JSON:
${JSON.stringify(summary, null, 2)}`;
}

export async function generateAndSavePeriodReport(type: PeriodType, reportDate: Date) {
  const summary = await aggregatePeriod(type, reportDate);
  let narrative: string;
  try {
    narrative = await generateNarrative(buildPeriodNarrativePrompt(summary));
  } catch (err) {
    narrative = `[해설 생성 실패: ${err instanceof Error ? err.message : String(err)}]`;
  }

  const { start, end } = getPrecedingPeriodBounds(type, reportDate);
  await db.periodReport.upsert({
    where: { periodType_periodStart: { periodType: type, periodStart: start } },
    create: { periodType: type, periodStart: start, periodEnd: end, summary: summary as unknown as Prisma.InputJsonValue, narrative },
    update: { periodEnd: end, summary: summary as unknown as Prisma.InputJsonValue, narrative },
  });

  return summary;
}

/**
 * 오늘 날짜 기준으로 실시일인 모든 주기(주/월/분기/년)를 검사해 필요한 것만 생성한다.
 * week -> month -> quarter -> year 순서로 처리해서, 상위 주기가 방금 저장된 하위 주기 리포트를
 * 바로 참조할 수 있게 한다(같은 날 여러 주기가 동시에 실시일일 수 있음, 예: 1월 1일).
 */
export async function generatePeriodReportsIfDue(today: Date) {
  const results: { type: PeriodType; generated: boolean }[] = [];
  for (const type of ["week", "month", "quarter", "year"] as PeriodType[]) {
    if (isReportDay(type, today)) {
      await generateAndSavePeriodReport(type, today);
      results.push({ type, generated: true });
    } else {
      results.push({ type, generated: false });
    }
  }
  return results;
}
