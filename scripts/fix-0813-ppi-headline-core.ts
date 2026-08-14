// PPI/PCE 헤드라인·근원 분리(CPI와 통일, commit 2a04b1f) 반영 전에 생성된 8/13 리포트를
// 새 코드로 재계산 — event-outcomes.ts가 이제 PPI를 헤드라인·근원 두 행으로 나눠 돌려주므로
// step1.recentEventOutcomes/step1Details가 달라진다. 사용자가 8/13 리포트도 반영해달라고
// 명시 요청(2026-08-14). fix-0807-dedup-and-regen.ts와 동일 패턴 — step5/6/7(라이브 전용 소스)은
// 원본 보존, step1(이번 수정 대상)·step2/3/4(asOf 재구성 가능)만 새로 계산.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { runDailyAnalysis } from "../src/lib/scoring/run";
import { generateNarrative, buildDailyNarrativePrompt } from "../src/lib/narrative";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";
import { scoreStep8, WEIGHTS, TOTAL_WEIGHT } from "../src/lib/scoring/pure";
import type { Step5Result, Step6Result, Step7Result, StepDetails } from "../src/lib/scoring/types";

async function main() {
  const date = new Date("2026-08-13T00:00:00.000Z");
  const existing = await db.dailyReport.findUnique({ where: { date } });
  if (!existing) {
    console.log("8/13 리포트 없음, 중단");
    return;
  }

  const asOf = existing.createdAt;
  const fresh = await runDailyAnalysis({ sectors: [] }, asOf);

  const originalStep5 = existing.step5 as unknown as Step5Result;
  const originalStep6 = existing.step6 as unknown as Step6Result;
  const originalStep7 = existing.step7 as unknown as Step7Result;
  const originalDetails = (existing.details ?? {}) as unknown as StepDetails;

  const step8 = scoreStep8({
    step1: fresh.step1,
    step2: fresh.step2,
    step3: fresh.step3,
    step4: fresh.step4,
    step5: originalStep5,
    step6: originalStep6,
    step7: originalStep7,
  });

  const step8Details = [
    { label: `2단계 유동성 (가중치 ${WEIGHTS.step2})`, criterion: "가중 반영", value: `${fresh.step2.finalScore.toFixed(2)} × ${WEIGHTS.step2} = ${(fresh.step2.finalScore * WEIGHTS.step2).toFixed(2)}`, met: null },
    { label: `3단계 캐리 트레이드 (가중치 ${WEIGHTS.step3})`, criterion: "가중 반영", value: `${fresh.step3.score.toFixed(2)} × ${WEIGHTS.step3} = ${(fresh.step3.score * WEIGHTS.step3).toFixed(2)}`, met: null },
    { label: `4단계 환율·금·유가 (가중치 ${WEIGHTS.step4})`, criterion: "가중 반영", value: `${fresh.step4.score.toFixed(2)} × ${WEIGHTS.step4} = ${(fresh.step4.score * WEIGHTS.step4).toFixed(2)}`, met: null },
    { label: `5단계 자금 도착 (가중치 ${WEIGHTS.step5})`, criterion: "가중 반영", value: `${originalStep5.score.toFixed(2)} × ${WEIGHTS.step5} = ${(originalStep5.score * WEIGHTS.step5).toFixed(2)}`, met: null },
    { label: `6단계 섹터 (가중치 ${WEIGHTS.step6})`, criterion: "가중 반영", value: `${originalStep6.score.toFixed(2)} × ${WEIGHTS.step6} = ${(originalStep6.score * WEIGHTS.step6).toFixed(2)}`, met: null },
    { label: "투자 적합도 점수", criterion: `가중합 / ${TOTAL_WEIGHT}`, value: step8.macroTrendScore.toFixed(3), met: null },
    { label: "1단계 거부권 적용", criterion: "발동 시 한 단계 하향", value: step8.vetoApplied ? "적용됨" : "미적용", met: !step8.vetoApplied },
    { label: "최종 결론", criterion: "≥7.0 매수\n≥5.0 지켜보기\n미만 현금비중늘리기", value: step8.finalDecision, met: null },
  ];

  const details: StepDetails = {
    ...originalDetails,
    step1: fresh.details.step1,
    step2: fresh.details.step2,
    step2Aux: fresh.details.step2Aux,
    step2Summary: fresh.details.step2Summary,
    step3: fresh.details.step3,
    step3Summary: fresh.details.step3Summary,
    step4: fresh.details.step4,
    step4Aux: fresh.details.step4Aux,
    step4Summary: fresh.details.step4Summary,
    step8: step8Details,
    forwardSignals: fresh.details.forwardSignals,
  };

  const narrativeReport = {
    step1: fresh.step1, step2: fresh.step2, step3: fresh.step3, step4: fresh.step4,
    step5: originalStep5, step6: originalStep6, step7: originalStep7, step8,
  };
  const narrative = await generateNarrative(buildDailyNarrativePrompt(narrativeReport));

  const comprehensiveReport = await generateComprehensiveReport({
    step1: fresh.step1, step2: fresh.step2, step3: fresh.step3, step4: fresh.step4,
    step5: originalStep5, step6: originalStep6, step7: originalStep7, step8,
    details,
  });
  const detailsWithComprehensive = { ...details, comprehensiveReport };

  const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
  await db.dailyReport.update({
    where: { date },
    data: {
      step1: asJson(fresh.step1),
      step2: asJson(fresh.step2),
      step3: asJson(fresh.step3),
      step4: asJson(fresh.step4),
      step8: asJson(step8),
      details: asJson(detailsWithComprehensive),
      narrative,
    },
  });

  console.log(
    `8/13 리포트 갱신 완료 — 결론: ${step8.finalDecision}, 점수: ${step8.macroTrendScore.toFixed(2)}`
  );
  for (const o of fresh.step1.recentEventOutcomes ?? []) {
    console.log(" -", o.name, o.subLabel ?? "", o.date, "|", o.detail);
  }
}

main().then(() => db.$disconnect());
