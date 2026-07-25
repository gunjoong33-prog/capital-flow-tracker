// TOTRESNS(월간) -> WRESBAL(주간)로 소스가 바뀌어서, 기존에 저장된 월간 데이터를 지우고
// 주간 데이터로 다시 채운다. 같은 metric 키("TOTRESNS")에 두 주기가 섞이면 "최근 N개" 로직이
// 왜곡되므로 반드시 지우고 다시 채워야 한다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { fetchFredMetric } from "../src/lib/sources/fred";
import { METRICS } from "../src/lib/sources/types";

async function main() {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error("FRED_API_KEY 없음");

  const deleted = await db.metricValue.deleteMany({ where: { metric: METRICS.TOTRESNS } });
  console.log(`기존 데이터 삭제: ${deleted.count}건`);

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const startDate = oneYearAgo.toISOString().slice(0, 10);

  const points = await fetchFredMetric(METRICS.TOTRESNS, key, startDate);
  let saved = 0;
  for (const p of points) {
    await db.metricValue.upsert({
      where: { metric_date: { metric: p.metric, date: new Date(p.date) } },
      create: { metric: p.metric, date: new Date(p.date), value: p.value, source: p.source },
      update: { value: p.value },
    });
    saved++;
  }
  console.log(`WRESBAL(주간) 재백필: ${saved}건 저장`);
}

main().then(() => db.$disconnect());
