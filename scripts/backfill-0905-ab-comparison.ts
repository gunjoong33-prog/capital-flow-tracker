// 2026-09-05 종합보고서 A/B 비교(comprehensiveReportNoContext) 기능 추가 직후 확인해보니, 오늘자
// 리포트의 기존 comprehensiveReport 자체가 오늘 아침 크론(자동배포가 끊겨있던 시점이라 아직 옛
// Mistral 코드로 실행됨)이 남긴 "[종합 보고서 생성 실패: Mistral 요청 실패: 429 ...]" 실패
// 문자열이었다 — 대조군만 채우면 비교가 무의미해서 원본도 Claude로 다시 생성한다.
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
  console.log("--- 원본(학습요약 포함, 재생성) ---");
  console.log(comprehensiveReport);

  const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
  await db.dailyReport.update({
    where: { date },
    data: { details: asJson({ ...details, comprehensiveReport }) },
  });
  console.log(`${dateStr} 원본 재생성·저장 완료`);
}

main().then(() => db.$disconnect());
