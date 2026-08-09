// 8/8 리포트 한정 예외 수정 — "미국 고용지표 발표(2026/8/7)"가 "실제 결과"(recentEventOutcomes)와
// "14일 내 예정된 이벤트"(upcomingEvents) 양쪽에 동시에 뜨던 자기모순(run.ts 코드 감사로 발견,
// 원인은 이미 수정함)을, 이미 저장된 이 리포트의 JSON에만 대상 지정으로 패치한다.
//
// runDailyAnalysis()를 다시 돌리지 않는다 — asOf 없이 재계산하면 뉴스·이벤트 윈도우가 "지금"
// 기준으로 다시 잡혀 이 리포트가 실제 반영했던 시점과 어긋나는 시계열 drift 위험이 있다(기존
// backfill 스크립트들의 원칙과 동일, 트래커에도 기록됨). 대신 이미 저장된 upcomingEvents/details
// 배열에서 recentEventOutcomes와 겹치는 이름+날짜만 걸러내고, 그 걸러낸 결과로 표시 문자열
// (details.step1의 "14일 내 예정된 이벤트" 행, details.forwardSignals.upcomingEvents)만
// run.ts와 똑같은 포맷 규칙으로 다시 만든다 — 다른 어떤 값도 건드리지 않는다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { slashDate } from "../src/lib/text-format";

interface UpcomingEvent { name: string; date: string }
interface EventOutcome { name: string; date: string }
interface StepDetailRow { label: string; criterion: string; value: string; met: boolean | null; result?: string; url?: string }

async function main() {
  const date = process.argv[2] ?? "2026-08-08";
  const report = await db.dailyReport.findUnique({ where: { date: new Date(date) } });
  if (!report) {
    console.log("no report for", date);
    return;
  }

  const step1 = report.step1 as unknown as {
    upcomingEvents: UpcomingEvent[];
    recentEventOutcomes: EventOutcome[];
    [key: string]: unknown;
  };
  const details = report.details as unknown as {
    step1: StepDetailRow[];
    forwardSignals?: { upcomingEvents: string | null; [key: string]: unknown };
    [key: string]: unknown;
  } | null;

  if (!details) {
    console.log("no details JSON for", date);
    return;
  }

  const evaluatedKeys = new Set(step1.recentEventOutcomes.map((o) => `${o.name}|${o.date}`));
  const before = step1.upcomingEvents;
  const after = before.filter((e) => !evaluatedKeys.has(`${e.name}|${e.date}`));

  const removed = before.filter((e) => evaluatedKeys.has(`${e.name}|${e.date}`));
  console.log("removed from upcomingEvents:", removed);
  if (removed.length === 0) {
    console.log("no duplicate found for", date, "— nothing to patch");
    return;
  }

  step1.upcomingEvents = after;

  const newValue = after.length > 0
    ? after.map((e) => `${e.name}(${slashDate(e.date)})`).join("\n")
    : "없음";
  const row = details.step1.find((r) => r.label === "14일 내 예정된 이벤트");
  if (row) row.value = newValue;

  if (details.forwardSignals) {
    details.forwardSignals.upcomingEvents = newValue !== "없음" ? newValue : null;
  }

  const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
  await db.dailyReport.update({
    where: { date: new Date(date) },
    data: { step1: asJson(step1), details: asJson(details) },
  });

  console.log(`${date} 리포트 패치 완료 — "14일 내 예정된 이벤트" 새 값:`, newValue);
}

main().then(() => db.$disconnect());
