import "dotenv/config";
import { db } from "../src/lib/db";
import { generateAndSavePeriodReport, type PeriodType } from "../src/lib/period-report";

async function main() {
  const type = process.argv[2] as PeriodType;
  const reportDateStr = process.argv[3];
  if (!type || !reportDateStr) {
    console.log("usage: tsx scripts/regen-period-report.ts <week|month|quarter|year> <YYYY-MM-DD 실시일>");
    return;
  }
  const summary = await generateAndSavePeriodReport(type, new Date(reportDateStr));
  console.log(JSON.stringify(summary, null, 2));
}

main().then(() => db.$disconnect());
