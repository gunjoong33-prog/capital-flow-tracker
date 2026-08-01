// 이미 저장된 step1~8(당일 값 그대로)은 건드리지 않고 comprehensiveReport 서술문만 새로 작성.
// live 데이터를 다시 불러오면 과거 날짜에 "오늘" 시점 값이 섞여 들어가므로, 반드시 DB에 이미
// 저장된 report 객체 그대로를 프롬프트에 넣는다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";

async function main() {
  const dateStr = process.argv[2];
  if (!dateStr) {
    console.log("usage: tsx scripts/regen-narrative-only.ts <YYYY-MM-DD>");
    return;
  }
  const date = new Date(dateStr);
  const existing = await db.dailyReport.findUnique({ where: { date } });
  if (!existing) {
    console.log(dateStr, "리포트 없음");
    return;
  }

  const report = {
    step1: existing.step1,
    step2: existing.step2,
    step3: existing.step3,
    step4: existing.step4,
    step5: existing.step5,
    step6: existing.step6,
    step7: existing.step7,
    step8: existing.step8,
    details: existing.details,
  };

  const comprehensiveReport = await generateComprehensiveReport(report);

  const existingDetails = (existing.details ?? {}) as Record<string, unknown>;
  const details = { ...existingDetails, comprehensiveReport };

  const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
  await db.dailyReport.update({
    where: { date },
    data: { details: asJson(details) },
  });

  console.log(`${dateStr} 종합 보고서 재작성 완료`);
  console.log(comprehensiveReport);
}

main().then(() => db.$disconnect());
