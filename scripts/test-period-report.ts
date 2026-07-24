import "dotenv/config";
import { db } from "../src/lib/db";
import { generateAndSavePeriodReport } from "../src/lib/period-report";

async function main() {
  const type = (process.argv[2] as "week" | "month" | "quarter" | "year") ?? "week";
  const date = process.argv[3] ? new Date(process.argv[3]) : new Date();
  const summary = await generateAndSavePeriodReport(type, date);
  console.log(JSON.stringify(summary, null, 2));
}

main().then(() => db.$disconnect());
