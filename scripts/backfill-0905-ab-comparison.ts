// 2026-09-05 종합보고서 A/B 비교(comprehensiveReportNoContext) 기능 추가 직후, 이미 생성된 오늘자
// 리포트에는 이 필드가 없다. 기존 comprehensiveReport는 그대로 두고 대조군만 추가로 생성해 채운다.
// 다음 날부터는 pipeline.ts가 매일 자동으로 두 버전을 다 채우므로 이 스크립트는 오늘 하루만 필요.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";
import type { StepDetails } from "../src/lib/scoring/types";

async function main() {
  const dateStr = "2026-09-05";
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const existing = await db.dailyReport.findUnique({ where: { date } });
  if (!existing) {
    console.log(`${dateStr} 리포트 없음, 중단`);
    return;
  }
  const details = existing.details as unknown as StepDetails;
  if (details.comprehensiveReportNoContext) {
    console.log("이미 대조군 있음, 중단");
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
  };

  const comprehensiveReportNoContext = await generateComprehensiveReport({ ...report, details }, { skipLearningContext: true });
  console.log("--- 대조군(학습요약 미포함) ---");
  console.log(comprehensiveReportNoContext);

  const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
  await db.dailyReport.update({
    where: { date },
    data: { details: asJson({ ...details, comprehensiveReportNoContext }) },
  });
  console.log(`${dateStr} 대조군 저장 완료`);
}

main().then(() => db.$disconnect());
