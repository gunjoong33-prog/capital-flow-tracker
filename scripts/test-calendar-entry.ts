import "dotenv/config";
import { db } from "../src/lib/db";
import { writeCalendarEntry } from "../src/lib/notion-write";

async function main() {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const report = await db.dailyReport.findUnique({ where: { date: new Date(date) } });
  if (!report) throw new Error(`${date} 리포트 없음`);
  const step8 = report.step8 as { finalDecision: string; macroTrendScore: number };
  const pageId = await writeCalendarEntry({
    date,
    finalDecision: step8.finalDecision,
    macroTrendScore: step8.macroTrendScore,
    narrative: report.narrative ?? "",
  });
  console.log("생성됨:", pageId);
}

main().then(() => db.$disconnect());
