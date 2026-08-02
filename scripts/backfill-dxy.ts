// 신규 METRICS.DXY(달러 인덱스, Yahoo DX-Y.NYB)를 1년치로 백필한다 — 새로 추가한 지표라
// DB에 이력이 전혀 없어서 그대로면 방향 판정이 항상 "확인 못함"으로 나온다.
// DXY는 거의 24시간 거래돼 1d봉이 정산가가 아니라 조회 시점 실시간가일 수 있어(8ca88ce에서
// 확인·수정) 반드시 미국장 마감 시각 기준 함수를 써야 한다 — 옛 함수 그대로였던 걸 수정.
// 실행: npx tsx scripts/backfill-dxy.ts
import "dotenv/config";
import { db } from "../src/lib/db";
import { fetchYahooHistoricalAtUsClose } from "../src/lib/sources/yahoo";
import { METRICS } from "../src/lib/sources/types";

async function main() {
  const points = await fetchYahooHistoricalAtUsClose(METRICS.DXY);
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
  console.log(`DXY: ${saved}건 저장`);
}

main().then(() => db.$disconnect());
