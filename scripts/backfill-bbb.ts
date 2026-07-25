import "dotenv/config";
import { db } from "../src/lib/db";
import { fetchFredMetric } from "../src/lib/sources/fred";
import { METRICS } from "../src/lib/sources/types";

async function main() {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error("FRED_API_KEY 없음");

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const startDate = oneYearAgo.toISOString().slice(0, 10);

  const points = await fetchFredMetric(METRICS.CREDIT_SPREAD_BBB, key, startDate);
  let saved = 0;
  for (const p of points) {
    await db.metricValue.upsert({
      where: { metric_date: { metric: p.metric, date: new Date(p.date) } },
      create: { metric: p.metric, date: new Date(p.date), value: p.value, source: p.source },
      update: { value: p.value },
    });
    saved++;
  }
  console.log(`BBB 스프레드: ${saved}건 저장`);
}

main().then(() => db.$disconnect());
