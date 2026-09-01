// 8/24주 주간 리포트의 comprehensiveReport가 Mistral 대형 모델 차단(403 tier_not_allowed,
// 계정 결제수단 미등록)으로 실패해 있었다. narrative는 원래 정상이라 건드리지 않고, 저장된
// [start,end]를 재확인한 뒤 같은 summary로 comprehensiveReport만 재생성한다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { aggregatePeriod, generatePeriodComprehensiveReport, getPrecedingPeriodBounds } from "../src/lib/period-report";

async function main() {
  const periodStart = new Date("2026-08-24T00:00:00.000Z");
  const week = await db.periodReport.findUnique({
    where: { periodType_periodStart: { periodType: "week", periodStart } },
  });
  if (!week) {
    console.log("8/24주 리포트 없음, 중단");
    return;
  }
  console.log(`대상: ${week.periodStart.toISOString().slice(0, 10)} ~ ${week.periodEnd.toISOString().slice(0, 10)}`);

  const reportDate = new Date(week.periodEnd);
  reportDate.setUTCDate(reportDate.getUTCDate() + 1);
  const bounds = getPrecedingPeriodBounds("week", reportDate);
  if (bounds.start.getTime() !== week.periodStart.getTime() || bounds.end.getTime() !== week.periodEnd.getTime()) {
    console.log("경고: 재계산된 기간이 저장된 기간과 다름", bounds, "vs", { start: week.periodStart, end: week.periodEnd });
    return;
  }

  const summary = await aggregatePeriod("week", reportDate);
  const comprehensiveReport = await generatePeriodComprehensiveReport(summary);

  await db.periodReport.update({
    where: { periodType_periodStart: { periodType: "week", periodStart: week.periodStart } },
    data: { comprehensiveReport, summary: summary as unknown as Prisma.InputJsonValue },
  });

  console.log("\n--- 종합보고서 ---");
  console.log(comprehensiveReport);
  console.log("\n8/24주 리포트 comprehensiveReport 갱신 완료");
}
main().then(() => db.$disconnect());
