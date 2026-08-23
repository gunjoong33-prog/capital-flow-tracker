// 읽기 전용 — 새 뉴스 위험 강도(0~10)를 과거 전 기간에 재계산해 임계값 후보별 발동률을 낸다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { computeNewsRiskIntensity } from "../src/lib/news-events";

async function main() {
  const reports = await db.dailyReport.findMany({ orderBy: { date: "asc" }, select: { date: true, step1: true } });
  const rows: { date: string; old: number; intensity: number; used: number; total: number }[] = [];
  for (const r of reports) {
    const asOf = r.date;
    const from = new Date(asOf);
    from.setUTCDate(from.getUTCDate() - 6);
    const events = await db.newsEvent.findMany({
      where: { date: { gte: from, lte: asOf } },
      select: { priority: true, severity: true, date: true },
    });
    const { intensity, usedCount, totalCount } = computeNewsRiskIntensity(events, asOf);
    rows.push({
      date: asOf.toISOString().slice(0, 10),
      old: (r.step1 as { newsRiskScore?: number }).newsRiskScore ?? 0,
      intensity, used: usedCount, total: totalCount,
    });
  }
  console.log("날짜        | 옛 합계점수 | 새 강도(0~10) | 사용/전체");
  for (const r of rows) {
    console.log(`${r.date} | ${String(r.old.toFixed(1)).padStart(10)} | ${String(r.intensity.toFixed(2)).padStart(12)} | ${r.used}/${r.total}`);
  }
  const v = rows.map((r) => r.intensity).sort((a, b) => a - b);
  const q = (p: number) => v[Math.min(v.length - 1, Math.round(p * (v.length - 1)))];
  console.log(`\n분포: 최소 ${v[0].toFixed(2)} / 중앙 ${q(0.5).toFixed(2)} / 75%ile ${q(0.75).toFixed(2)} / 85%ile ${q(0.85).toFixed(2)} / 90%ile ${q(0.9).toFixed(2)} / 최대 ${v[v.length-1].toFixed(2)}`);
  for (const t of [3, 4, 5, 6, q(0.85), q(0.9)]) {
    const n = v.filter((x) => x >= t).length;
    console.log(`  임계 ${t.toFixed(2)} -> 발동 ${n}/${v.length} (${Math.round((n / v.length) * 100)}%)`);
  }
}
main().finally(() => db.$disconnect());
