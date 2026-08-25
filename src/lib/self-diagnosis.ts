// 자가진단 오케스트레이션 — DB에서 최근 리포트·적중 데이터를 읽어 detectDivergence(순수 로직)에
// 넘기고, 하루 자동배포 상한(Global Constraints)을 여기서 체크한다.
import { db } from "@/lib/db";
import { computeVerdictOutcomes } from "@/lib/verdict-outcomes";
import { detectDivergence } from "@/lib/self-diagnosis-pure";

const DAILY_AUTO_DEPLOY_LIMIT = 1;

export async function runSelfDiagnosis(): Promise<{ issueDetected: boolean; issueDescription: string | null }> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayDeployCount = await db.autoFixLog.count({ where: { createdAt: { gte: startOfToday }, deployed: true } });

  const recentReports = await db.dailyReport.findMany({ orderBy: { date: "desc" }, take: 30 });
  const verdictInputs = recentReports.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    marketDate: r.marketDate?.toISOString().slice(0, 10) ?? null,
    finalDecision: (r.step8 as unknown as { finalDecision: string }).finalDecision,
  }));
  const outcomes = await computeVerdictOutcomes(verdictInputs);
  const verdicts = outcomes.map((o) => ({ date: o.date, hit: o.hitSp500 }));

  const patterns = detectDivergence(verdicts);
  if (patterns.length === 0) return { issueDetected: false, issueDescription: null };

  if (todayDeployCount >= DAILY_AUTO_DEPLOY_LIMIT) {
    return { issueDetected: false, issueDescription: null }; // 상한 도달 — 이상은 있지만 오늘은 더 안 건드림
  }

  return { issueDetected: true, issueDescription: patterns.map((p) => p.detail).join("; ") };
}
