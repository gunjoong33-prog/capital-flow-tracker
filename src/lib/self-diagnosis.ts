// 자가진단 오케스트레이션 — DB에서 최근 리포트·적중 데이터를 읽어 detectDivergence(순수 로직)에
// 넘기고, 하루 자동배포 상한(Global Constraints)을 여기서 체크한다.
import { db } from "@/lib/db";
import { computeVerdictOutcomes } from "@/lib/verdict-outcomes";
import { detectDivergence } from "@/lib/self-diagnosis-pure";
import { kstToday } from "@/lib/date";

const DAILY_AUTO_DEPLOY_LIMIT = 1;

export async function runSelfDiagnosis(): Promise<{ issueDetected: boolean; issueDescription: string | null }> {
  const startOfTodayKst = new Date(`${kstToday()}T00:00:00+09:00`);
  const todayDeployCount = await db.autoFixLog.count({ where: { createdAt: { gte: startOfTodayKst }, deployed: true } });

  // orderBy desc는 "최근 30건"을 뽑는 효율적인 쿼리 방향이지만, detectDivergence는
  // graded[graded.length - 1]을 "가장 최근"으로 보고 뒤에서 앞으로 훑는다(오름차순 기대).
  // reverse 없이 넘기면 최신 연속 실패가 아니라 몇 주 전 구간을 "최근 이상"으로 오판한다.
  const recentReports = await db.dailyReport.findMany({ orderBy: { date: "desc" }, take: 30 });
  const verdictInputs = recentReports.slice().reverse().map((r) => ({
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

  const issueDescription = patterns.map((p) => p.detail).join("; ");

  // 같은 이상이 오늘 이미 자동수정 시도 대상이었으면 다시 트리거하지 않는다 — 배포 상한(위 체크)은
  // "오늘 이미 배포 성공"만 막아서, 며칠 연속으로 테스트/가드에 걸려 배포까지 못 간 실패 스트릭이면
  // 같은 문자열의 detectedIssue로 매일 새 AutoFixLog가 쌓이고 매일 똑같은 "고치기" 시도가 반복된다.
  const sameIssueToday = await db.autoFixLog.count({
    where: { detectedIssue: issueDescription, createdAt: { gte: startOfTodayKst } },
  });
  if (sameIssueToday > 0) {
    return { issueDetected: false, issueDescription: null };
  }

  return { issueDetected: true, issueDescription };
}
