// 8/31·9/1(marketDate 기준) 종합보고서가 mistral-small-latest 강등 이후 소제목·영어 혼용
// 형식으로 어긋난 것을 고친다(comprehensive-report.ts 프롬프트 강화 + sanitizeFormat 반영 후
// 재생성). 숫자는 이미 맞으므로 asOf 재구성 없이 저장된 step1~8/details 그대로 재사용한다
// (fix-0901-mistral-key-regen.ts와 동일한 패턴).
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";
import type { StepDetails } from "../src/lib/scoring/types";

async function regen(rowDate: string) {
  const date = new Date(`${rowDate}T00:00:00.000Z`);
  const existing = await db.dailyReport.findUnique({ where: { date } });
  if (!existing) {
    console.log(`${rowDate} 리포트 없음, 중단`);
    return;
  }

  const details = existing.details as unknown as StepDetails;
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

  const comprehensiveReport = await generateComprehensiveReport({ ...report, details });
  console.log(`\n--- ${rowDate} comprehensiveReport ---`);
  console.log(comprehensiveReport);

  const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
  await db.dailyReport.update({
    where: { date },
    data: { details: asJson({ ...details, comprehensiveReport }) },
  });
  console.log(`${rowDate} 종합보고서 갱신 완료`);
}

async function main() {
  // row date=2026-09-02 → marketDate=2026-09-01. 1차 재생성에 외래어("circulating money",
  // "insgesamt")가 남아 재시도.
  await regen("2026-09-02");
}

main().then(() => db.$disconnect());
