// US10Y-JP10Y 스프레드(bp) 전용 백분위 버킷 백필 — US10Y·JP10Y는 이미 DB에 1년치가 있으므로
// 외부 API 호출 없이 기존 데이터로 파생 계산만 한다.
// 실행: npx tsx scripts/backfill-us-jp-spread.ts
import "dotenv/config";
import { db } from "../src/lib/db";
import { METRICS } from "../src/lib/sources/types";

async function main() {
  const us10y = await db.metricValue.findMany({ where: { metric: METRICS.US10Y }, orderBy: { date: "asc" } });
  const jp10y = await db.metricValue.findMany({ where: { metric: METRICS.JP10Y }, orderBy: { date: "asc" } });
  const jpByDate = new Map(jp10y.map((r) => [r.date.toISOString().slice(0, 10), r.value]));

  let saved = 0;
  for (const us of us10y) {
    const jp = jpByDate.get(us.date.toISOString().slice(0, 10));
    if (jp === undefined) continue;
    const spreadBp = (us.value - jp) * 100;
    await db.metricValue.upsert({
      where: { metric_date: { metric: "US10Y_JP10Y_SPREAD_BP", date: us.date } },
      create: { metric: "US10Y_JP10Y_SPREAD_BP", date: us.date, value: spreadBp, source: "manual" },
      update: { value: spreadBp },
    });
    saved++;
  }
  console.log(`US10Y_JP10Y_SPREAD_BP: ${saved}건 저장`);
}

main().then(() => db.$disconnect());
