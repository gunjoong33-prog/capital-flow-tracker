import "dotenv/config";
import { db } from "../src/lib/db";
async function main() {
  const reports = await db.dailyReport.findMany({ orderBy: { date: "asc" }, select: { date: true } });
  const rules: Record<string, number> = {};
  for (const r of reports) {
    const asOf = r.date;
    const d1 = new Date(asOf); d1.setUTCDate(d1.getUTCDate() - 1);
    const highs = await db.newsEvent.findMany({ where: { severity: "high", date: { gte: d1, lte: asOf } }, select: { priority: true, date: true } });
    const highs7 = await db.newsEvent.count({ where: { severity: "high", date: { gte: new Date(asOf.getTime() - 6 * 864e5), lte: asOf } } });
    const test: Record<string, boolean> = {
      "현행: 7일 내 high 1건 이상": highs7 >= 1,
      "최근 2일 high 2건 이상": highs.length >= 2,
      "최근 2일 high 3건 이상": highs.length >= 3,
      "최근 2일 high 4건 이상": highs.length >= 4,
      "최근 2일 high + 공식출처(priority 0)": highs.some((h) => h.priority === 0),
      "최근 2일 high + 공식/유출(priority<=1)": highs.some((h) => h.priority <= 1),
      "최근 2일 high 공식출처 2건 이상": highs.filter((h) => h.priority === 0).length >= 2,
    };
    for (const [k, v] of Object.entries(test)) if (v) rules[k] = (rules[k] ?? 0) + 1;
  }
  const n = reports.length;
  console.log(`규칙별 발동률 (전체 ${n}일)`);
  for (const [k, c] of Object.entries(rules)) console.log(`  ${String(Math.round(c/n*100)).padStart(3)}%  (${c}/${n})  ${k}`);
  const pri = await db.newsEvent.groupBy({ by: ["priority"], where: { severity: "high" }, _count: { id: true } });
  console.log("\nhigh 뉴스의 출처 분포:", pri.map(p => `priority${p.priority}=${p._count.id}`).join(" "));
}
main().finally(() => db.$disconnect());
