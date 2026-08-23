import "dotenv/config";
import { db } from "../src/lib/db";
import { computeVerdictOutcomes, hitStats } from "../src/lib/verdict-outcomes";
import { computeNewsRiskIntensity, SEVERE_NEWS_WINDOW_DAYS, SEVERE_NEWS_MAX_PRIORITY } from "../src/lib/news-events";
import { NEWS_RISK_INTENSITY_THRESHOLD } from "../src/lib/scoring/types";
import type { Step8Result } from "../src/lib/scoring/types";

async function main() {
  const rows = await db.dailyReport.findMany({ orderBy: { date: "asc" }, select: { date: true, marketDate: true, step1: true, step8: true } });
  const verdicts = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    marketDate: r.marketDate ? r.marketDate.toISOString().slice(0, 10) : null,
    finalDecision: (r.step8 as unknown as Step8Result).finalDecision,
  }));
  const outcomes = await computeVerdictOutcomes(verdicts);
  const sp = hitStats(outcomes, "hitSp500"), ko = hitStats(outcomes, "hitKospi");
  console.log("=== 적중률 (수정 후) ===");
  console.log(`S&P500  ${sp!.hits}/${sp!.graded} = ${sp!.pct}%  (오차범위 ${sp!.ciLowPct}~${sp!.ciHighPct}%)`);
  console.log(`코스피  ${ko!.hits}/${ko!.graded} = ${ko!.pct}%  (오차범위 ${ko!.ciLowPct}~${ko!.ciHighPct}%)`);

  const dows = ["일","월","화","수","목","금","토"];
  const dowCount: Record<string, number> = {};
  for (const v of verdicts) {
    const k = dows[new Date(`${v.marketDate ?? v.date}T00:00:00Z`).getUTCDay()];
    dowCount[k] = (dowCount[k] ?? 0) + 1;
  }
  console.log("\n=== 표에 뜨는 요일 (수정 후, marketDate 기준) ===");
  console.log(dows.map((d) => `${d}:${dowCount[d] ?? 0}`).join("  "));

  console.log("\n=== 거부권 재판정 (새 규칙을 과거 21일에 적용) ===");
  let oldVeto = 0, newVeto = 0;
  for (const r of rows) {
    const asOf = r.date;
    const from = new Date(asOf); from.setUTCDate(from.getUTCDate() - 6);
    const events = await db.newsEvent.findMany({ where: { date: { gte: from, lte: asOf } }, select: { priority: true, severity: true, date: true } });
    const { intensity } = computeNewsRiskIntensity(events, asOf);
    const cut = new Date(asOf); cut.setUTCDate(cut.getUTCDate() - (SEVERE_NEWS_WINDOW_DAYS - 1));
    const severe = events.some((e) => e.severity === "high" && e.priority <= SEVERE_NEWS_MAX_PRIORITY && e.date >= cut);
    const s1 = r.step1 as { vetoTriggered?: boolean; recentEventOutcomes?: { risky: boolean }[] };
    const surprise = (s1.recentEventOutcomes ?? []).some((o) => o.risky);
    const nv = intensity >= NEWS_RISK_INTENSITY_THRESHOLD || severe || surprise;
    if (s1.vetoTriggered) oldVeto++;
    if (nv) newVeto++;
  }
  const n = rows.length;
  console.log(`기존 규칙: ${oldVeto}/${n} (${Math.round(oldVeto/n*100)}%) 발동`);
  console.log(`새 규칙  : ${newVeto}/${n} (${Math.round(newVeto/n*100)}%) 발동`);
}
main().finally(() => db.$disconnect());
