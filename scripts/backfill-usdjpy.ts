// USDJPY 종가 시계열이 예전 intraday 크론(jpy-check)에 덮어써져 최근 60일 변동성이 인위적으로
// 줄어든 상태였다(외부 감사 지적, cb39f73에서 원인은 분리했지만 과거 데이터는 그대로 남아있었다).
// Yahoo에서 1년치 종가를 다시 받아 upsert로 강제 덮어써 정상화한다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { fetchYahooHistorical } from "../src/lib/sources/yahoo";
import { METRICS } from "../src/lib/sources/types";

async function main() {
  const points = await fetchYahooHistorical(METRICS.USDJPY);
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
  console.log(`USDJPY: ${saved}건 재백필 완료`);
}

main().then(() => db.$disconnect());
