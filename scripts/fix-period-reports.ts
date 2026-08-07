// (1) 분기(quarter) PeriodReport 삭제 — 사용자 확인: 지난 분기가 아니라 현재 분기(2026-07-01~
//     2026-09-30)가 저장돼 있던 버그성 데이터, 원인 파악 없이 우선 삭제만 요청받음.
// (2) 주간(week, 2026-07-27~2026-08-01) 리포트에 종합보고서(comprehensiveReport) 추가 —
//     narrative는 이미 정상이라 건드리지 않고, 저장된 summary를 그대로 재사용해 종합보고서만
//     새로 생성한다(같은 [start,end] 재집계이므로 summary는 원래와 동일하게 나옴).
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { aggregatePeriod, generatePeriodComprehensiveReport, getPrecedingPeriodBounds } from "../src/lib/period-report";

async function main() {
  const deleted = await db.periodReport.deleteMany({ where: { periodType: "quarter" } });
  console.log(`분기 리포트 ${deleted.count}건 삭제`);

  const week = await db.periodReport.findFirst({ where: { periodType: "week" }, orderBy: { periodStart: "desc" } });
  if (!week) {
    console.log("주간 리포트 없음, 중단");
    return;
  }
  console.log(`대상 주간 리포트: ${week.periodStart.toISOString().slice(0, 10)} ~ ${week.periodEnd.toISOString().slice(0, 10)}`);

  // reportDate는 "실시일"(해당 주기가 끝난 다음날) 기준으로 [start,end]를 역산하는 데만 쓰인다 —
  // periodEnd 다음날을 넣으면 저장된 것과 동일한 [start,end]가 재현된다.
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
}
main().then(() => db.$disconnect());
