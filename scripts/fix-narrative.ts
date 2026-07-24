import "dotenv/config";
import { db } from "../src/lib/db";
import { generateNarrative, buildDailyNarrativePrompt } from "../src/lib/narrative";

async function main() {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const report = await db.dailyReport.findUnique({ where: { date: new Date(date) } });
  if (!report) {
    console.log(`${date} 리포트 없음`);
    return;
  }
  const narrative = await generateNarrative(
    buildDailyNarrativePrompt({
      step1: report.step1, step2: report.step2, step3: report.step3, step4: report.step4,
      step5: report.step5, step6: report.step6, step7: report.step7, step8: report.step8,
    })
  );
  await db.dailyReport.update({ where: { date: new Date(date) }, data: { narrative } });
  console.log("새 narrative:", narrative);
}

main().then(() => db.$disconnect());
