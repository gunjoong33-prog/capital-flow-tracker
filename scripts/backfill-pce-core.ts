// 근원(Core) PCE(PCEPILFE)를 5년치로 백필한다 — 새로 추가한 METRICS.US_PCE_CORE라 DB에 이력이
// 전혀 없어서 그대로면 YoY/z-score 계산이 항상 "데이터 부족"으로 나온다.
// 실행: npx tsx scripts/backfill-pce-core.ts
import "dotenv/config";
import { db } from "../src/lib/db";
import { fetchFredMetric } from "../src/lib/sources/fred";
import { METRICS } from "../src/lib/sources/types";

async function main() {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error("FRED_API_KEY 없음");

  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  const startDate = fiveYearsAgo.toISOString().slice(0, 10);

  const points = await fetchFredMetric(METRICS.US_PCE_CORE, key, startDate);
  let saved = 0;
  for (const p of points) {
    if (Number.isNaN(p.value)) continue;
    await db.metricValue.upsert({
      where: { metric_date: { metric: p.metric, date: new Date(p.date) } },
      create: { metric: p.metric, date: new Date(p.date), value: p.value, source: p.source },
      update: { value: p.value },
    });
    saved++;
  }
  console.log(`근원 PCE(PCEPILFE): ${saved}건 저장`);
}

main().then(() => db.$disconnect());
