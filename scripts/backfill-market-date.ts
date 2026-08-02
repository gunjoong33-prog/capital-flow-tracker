// 기존에 저장된 DailyReport에는 marketDate가 없다(컬럼을 방금 추가했다) — 각 리포트 생성 시점에
// 실제로 최신이었던 SPX 종가일을 역으로 찾아 채워 넣는다. 이렇게 해야 과거 8/1·8/2처럼 이미
// 저장된 중복 리포트도 marketDate 기준으로 묶어서 백테스트에서 걸러낼 수 있다(새 리포트만 막는
// pipeline.ts 쪽 방지 로직과 별개로 필요).
import "dotenv/config";
import { db } from "../src/lib/db";
import { METRICS } from "../src/lib/sources/types";

async function main() {
  const reports = await db.dailyReport.findMany({ where: { marketDate: null }, orderBy: { date: "asc" } });
  let updated = 0;
  for (const r of reports) {
    const spx = await db.metricValue.findFirst({
      where: { metric: METRICS.SPX, date: { lte: r.date } },
      orderBy: { date: "desc" },
    });
    if (!spx) {
      console.log(r.date.toISOString().slice(0, 10), "— SPX 이력 없음, 건너뜀");
      continue;
    }
    await db.dailyReport.update({ where: { id: r.id }, data: { marketDate: spx.date } });
    console.log(r.date.toISOString().slice(0, 10), "-> marketDate", spx.date.toISOString().slice(0, 10));
    updated++;
  }
  console.log(`${updated}건 marketDate 백필 완료`);
}

main().then(() => db.$disconnect());
