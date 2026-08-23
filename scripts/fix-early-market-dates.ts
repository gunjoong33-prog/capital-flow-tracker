// 7/27~7/31 다섯 행의 marketDate 정정. backfill-market-date.ts가 lte로 조회해 "발행 시점엔 아직
// 없던 당일 종가"를 넣어둔 것을 실제 직전 거래일로 되돌린다. 중복(7/31행과 8/1행이 같은 거래일을
// 가리키던 문제)도 이걸로 해소된다. 멱등: 이미 정정된 행은 건너뛴다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { METRICS } from "../src/lib/sources/types";

async function main() {
  const rows = await db.dailyReport.findMany({ orderBy: { date: "asc" }, select: { id: true, date: true, marketDate: true } });
  let fixed = 0;
  for (const r of rows) {
    const md = r.marketDate?.toISOString().slice(0, 10);
    const d = r.date.toISOString().slice(0, 10);
    if (md !== d) continue; // 이미 정상(하루 차이)
    const spx = await db.metricValue.findFirst({
      where: { metric: METRICS.SPX, date: { lt: r.date } },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    if (!spx) { console.log(`${d}: 직전 SPX 종가 없음 — 건너뜀`); continue; }
    await db.dailyReport.update({ where: { id: r.id }, data: { marketDate: spx.date } });
    console.log(`${d}: marketDate ${md} -> ${spx.date.toISOString().slice(0, 10)}`);
    fixed++;
  }
  const after = await db.dailyReport.findMany({ select: { marketDate: true } });
  const keys = after.map((r) => r.marketDate?.toISOString().slice(0, 10) ?? "null");
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  console.log(`\n${fixed}건 정정. 남은 marketDate 중복: ${dup.length === 0 ? "없음" : dup.join(", ")}`);
}
main().finally(() => db.$disconnect());
