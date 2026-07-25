// 노션 재기록 없이 사이트 DB의 오늘자 리포트(step1~8, details)만 최신 코드로 재계산해서 갱신.
// 채점 로직이나 표시 라벨을 고친 뒤, 이미 저장된 리포트에 반영하고 싶을 때 사용.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { runDailyAnalysis } from "../src/lib/scoring/run";
import { getManualInputsForDate } from "../src/lib/manual-inputs";
import { fetchAllSectors } from "../src/lib/sources/yahoo";

async function main() {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const existing = await db.dailyReport.findUnique({ where: { date: new Date(date) } });
  if (!existing) {
    console.log("no report for", date);
    return;
  }

  const manualInputs = await getManualInputsForDate(date);
  let sectors: { name: string; return5d: number; volumeRatio: number }[] = [];
  try {
    sectors = await fetchAllSectors();
  } catch {
    // 섹터 조회 실패해도 나머지는 갱신
  }

  const report = await runDailyAnalysis({
    domesticWeightHigh: manualInputs.domesticWeightHigh,
    fearGreed: manualInputs.fearGreed,
    sectors: sectors.map((s) => ({ name: s.name, return5d: s.return5d, volumeRatio: s.volumeRatio })),
  });

  const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
  await db.dailyReport.update({
    where: { date: new Date(date) },
    data: {
      step1: asJson(report.step1), step2: asJson(report.step2), step3: asJson(report.step3), step4: asJson(report.step4),
      step5: asJson(report.step5), step6: asJson(report.step6), step7: asJson(report.step7), step8: asJson(report.step8),
      details: asJson(report.details),
    },
  });

  console.log(`${date} 리포트 갱신 완료`);
  console.log(JSON.stringify(report.details.step1, null, 2));
}

main().then(() => db.$disconnect());
