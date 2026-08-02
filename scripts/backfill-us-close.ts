// GOLD·WTI·BRENT·USDKRW·USDJPY·DXY는 09:00 KST 파이프라인 시점에 거의 24시간 거래 중이라 기존
// 1d봉 close가 진짜 정산가가 아니라 조회 시점 실시간가였다(사용자 지적, 실제 확인). yahoo.ts에
// 추가한 fetchYahooHistoricalAtUsClose()로 뉴욕 정규장 마감(16:00 ET) 기준 값을 다시 받아 강제
// 덮어쓴다. Yahoo 장중봉 보관 한도가 약 60일이라 그 이전 과거는 되돌릴 수 없다(1d봉 값 그대로 남음).
import "dotenv/config";
import { db } from "../src/lib/db";
import { fetchYahooHistoricalAtUsClose } from "../src/lib/sources/yahoo";
import { METRICS } from "../src/lib/sources/types";

const TARGET_METRICS = [METRICS.GOLD, METRICS.WTI, METRICS.BRENT, METRICS.USDKRW, METRICS.USDJPY, METRICS.DXY];

async function main() {
  for (const metric of TARGET_METRICS) {
    try {
      const points = await fetchYahooHistoricalAtUsClose(metric);
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
      console.log(`${metric}: ${saved}건 미국장 마감 기준으로 재백필 완료`);
    } catch (err) {
      console.log(`${metric}: 실패 —`, err instanceof Error ? err.message : err);
    }
  }
}

main().then(() => db.$disconnect());
