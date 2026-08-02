// USDJPY 종가 시계열이 예전 intraday 크론(jpy-check)에 덮어써져 최근 60일 변동성이 인위적으로
// 줄어든 상태였다(외부 감사 지적, cb39f73에서 원인은 분리했지만 과거 데이터는 그대로 남아있었다).
// USDJPY는 거의 24시간 거래돼 1d봉이 정산가가 아니라 조회 시점 실시간가일 수 있어(8ca88ce에서
// 확인·수정) 반드시 미국장 마감 시각 기준 함수를 써야 한다 — 이 스크립트가 옛 함수 그대로라
// 다시 실행하면 이미 고친 오염을 되살리는 문제가 있었다(외부 지적, 실제 확인).
import "dotenv/config";
import { db } from "../src/lib/db";
import { fetchYahooHistoricalAtUsClose } from "../src/lib/sources/yahoo";
import { METRICS } from "../src/lib/sources/types";

async function main() {
  const points = await fetchYahooHistoricalAtUsClose(METRICS.USDJPY);
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
