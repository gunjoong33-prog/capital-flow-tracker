// FRED 지표 전체(18개)를 5년치로 다시 백필한다.
// backfill.ts는 콜드스타트용 1년 창이라 REAL_RATE(월간, 1년=13개)처럼 표본이 30개 미만인
// 지표는 calculatePercentile()이 항상 null을 반환한다 — 2단계 실질금리 백분위를 쓰려면
// 이 창을 넓혀야 한다. FRED 원본은 이미 수십 년치가 있으니 upsert라 안전하게 재실행 가능.
// 실행: npx tsx scripts/backfill-fred-deep.ts
import "dotenv/config";
import { db } from "../src/lib/db";
import { fetchAllFredMetrics } from "../src/lib/sources/fred";

async function main() {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error("FRED_API_KEY 없음");

  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  const startDate = fiveYearsAgo.toISOString().slice(0, 10);

  const { points, errors } = await fetchAllFredMetrics(key, startDate);
  let saved = 0;
  for (const p of points) {
    if (Number.isNaN(p.value)) continue;
    await db.metricValue.upsert({
      where: { metric_date: { metric: p.metric, date: new Date(p.date) } },
      create: { metric: p.metric, date: new Date(p.date), value: p.value, source: p.source },
      update: { value: p.value, source: p.source },
    });
    saved++;
  }
  console.log(`FRED 5년 백필 완료: ${saved}건 저장`);
  if (errors.length) console.log("오류:", errors);
}

main().then(() => db.$disconnect());
