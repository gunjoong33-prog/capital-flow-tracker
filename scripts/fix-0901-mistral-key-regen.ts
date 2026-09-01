// 9/1 리포트는 계산(step1~8)은 정상 완료됐고, 마지막 두 Mistral 호출(narrative, 종합보고서)만
// API 키 만료(403 tier_not_allowed)로 실패해 에러 문자열이 대신 저장됐다. 숫자는 이미 맞으므로
// asOf 재구성 없이, 저장된 step1~8/details 그대로를 프롬프트에 다시 넣어 두 LLM 필드만 채운다.
// .env의 MISTRAL_API_KEY를 새 키로 교체한 뒤 실행.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { generateNarrative, buildDailyNarrativePrompt } from "../src/lib/narrative";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";
import type { StepDetails } from "../src/lib/scoring/types";

async function main() {
  const date = new Date("2026-09-01T00:00:00.000Z");
  const existing = await db.dailyReport.findUnique({ where: { date } });
  if (!existing) {
    console.log("9/1 리포트 없음, 중단");
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

  const narrative = await generateNarrative(buildDailyNarrativePrompt(report));
  console.log("--- narrative ---");
  console.log(narrative);

  const comprehensiveReport = await generateComprehensiveReport({ ...report, details });
  console.log("\n--- comprehensiveReport ---");
  console.log(comprehensiveReport);

  const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
  await db.dailyReport.update({
    where: { date },
    data: {
      narrative,
      details: asJson({ ...details, comprehensiveReport }),
    },
  });

  console.log("\n9/1 리포트 narrative·종합보고서 갱신 완료");
}

main().then(() => db.$disconnect());
