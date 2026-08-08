// 8/8 리포트 한정 수동 예외 수정 — 고용지표(NFP) 실제 결과 문구를 검증된 실제 발표치로 정정한다.
// 저장된 METRICS.US_NFP(FRED PAYEMS) 값 자체가 틀렸다는 게 확인됐지만(-126,000명으로 계산됨,
// 실제 2026년 7월 고용보고서는 Bloomberg·BLS 확인 결과 -23,000명 — BLS가 같은 발표에서 5·6월을
// 합산 -103,000 하향 수정한 걸 이 앱의 PAYEMS 재수집 로직이 구분 못 하고 하나의 월간 변화량에
// 섞어버린 것으로 진단됨, [[capital_flow_tracker_narrative_audit_2026_08]] 참고), 그 근본 원인
// (FRED 재수집 시 vintage 미보존 + evaluateRecentEventOutcomes의 당일 이벤트 조기 매칭) 수정은
// 별도 조사·승인이 필요해 이번엔 손대지 않는다. 사용자 요청대로 8/8 리포트 하나만, 검증된 실제
// 수치로 손으로 정정한다 — 다른 날짜·다른 지표는 건드리지 않는다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";
import type { Step1Result, StepDetails, StepDetailRow } from "../src/lib/scoring/types";

const DATE = "2026-08-08";
const CORRECT_DETAIL = "변화량 -23,000명 (2026년 7월 고용보고서 실제 발표치 — 자동 수집된 원본값이 5·6월 하향 수정분과 섞여 부정확해 수동으로 정정함)";

async function main() {
  const existing = await db.dailyReport.findUnique({ where: { date: new Date(DATE) } });
  if (!existing) throw new Error(`${DATE} 리포트 없음`);

  const step1 = existing.step1 as unknown as Step1Result & { riskyNewsCount?: number };
  const details = existing.details as unknown as StepDetails;

  const patchedOutcomes = (step1.recentEventOutcomes ?? []).map((o) =>
    o.name === "미국 고용지표 발표" ? { ...o, detail: CORRECT_DETAIL } : o
  );
  const mixedStep1 = { ...step1, recentEventOutcomes: patchedOutcomes, riskyNewsCount: (step1.riskyNews ?? []).length };

  const mixedDetailsStep1: StepDetailRow[] = (details.step1 ?? []).map((row) =>
    row.label.startsWith("미국 고용지표 발표") && row.label.includes("실제 결과") ? { ...row, value: CORRECT_DETAIL } : row
  );

  const mixedDetails: StepDetails = { ...details, step1: mixedDetailsStep1 };

  const reportForNarrative = {
    step1: mixedStep1,
    step2: existing.step2,
    step3: existing.step3,
    step4: existing.step4,
    step5: existing.step5,
    step6: existing.step6,
    step7: existing.step7,
    step8: existing.step8,
    details: mixedDetails,
  };

  const comprehensiveReport = await generateComprehensiveReport(reportForNarrative);
  mixedDetails.comprehensiveReport = comprehensiveReport;

  const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
  await db.dailyReport.update({
    where: { date: new Date(DATE) },
    data: { step1: asJson(mixedStep1), details: asJson(mixedDetails) },
  });

  console.log(`${DATE} 수동 정정 완료`);
  console.log(comprehensiveReport);
}

main().then(() => db.$disconnect());
