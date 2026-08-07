// 사용자가 검토 후 승인한 8/7 뉴스 중복 3건(폴리실리콘 백악관/BBC, 우크라이나 정유시설 2건 보도,
// 미중 상호제재 2건 보도)만 병합 삭제 — 애매했던 2건(케인 상원의원 비판, 레바논 언론인 피살)은
// 과병합 의심으로 사용자가 명시적으로 제외를 선택했다. mergeCrossSourceDuplicates()를 통째로
// 재실행하지 않고 승인된 클러스터만 하드코딩해 정확히 그 3건만 지운다.
//
// recalibrate-news-severity.ts / reapply-news-calibration.ts와 같은 원칙의 예외적 소급 수정 —
// 사용자가 "오늘자 리포트도 수정해서 다시 작성"이라고 명시적으로 요청.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { runDailyAnalysis } from "../src/lib/scoring/run";
import { generateNarrative, buildDailyNarrativePrompt } from "../src/lib/narrative";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";
import { scoreStep8, WEIGHTS, TOTAL_WEIGHT } from "../src/lib/scoring/pure";
import type { Step5Result, Step6Result, Step7Result, StepDetails } from "../src/lib/scoring/types";

const APPROVED_CLUSTERS: [string, string][] = [
  [
    "Adjusting Imports of Polysilicon and its Derivatives into the United States",
    "Trump imposes 15% tariff on key chip material to counter China",
  ],
  [
    "Ukraine’s military hits one of Russia’s biggest oil refineries in long-range drone attack - CNBC",
    "Ukraine hits two oil refineries deep in Russian territory",
  ],
  [
    "Analysis: As US and China throw up tit-for-tat sanctions, is Trump’s Xi meeting at risk? - CNN",
    "China retaliates on US sanctions; North Korea’s dog meat advisory: 7 highlights - South China Morning Post",
  ],
];

const CATEGORY_PRIORITY: Record<string, number> = { official: 0, "power-network": 1, general: 2 };

async function main() {
  const date = new Date("2026-08-07T00:00:00.000Z");
  const rows = await db.newsEvent.findMany({ where: { date } });

  const toDelete: string[] = [];
  for (const [titleA, titleB] of APPROVED_CLUSTERS) {
    const a = rows.find((r) => r.title === titleA);
    const b = rows.find((r) => r.title === titleB);
    if (!a || !b) {
      console.log(`경고: 매칭 실패 — "${titleA}" / "${titleB}"`);
      continue;
    }
    const priorityA = CATEGORY_PRIORITY[a.source] ?? 2;
    const priorityB = CATEGORY_PRIORITY[b.source] ?? 2;
    let loser: (typeof rows)[number];
    if (priorityA < priorityB) loser = b;
    else if (priorityB < priorityA) loser = a;
    else loser = a.summary.length >= b.summary.length ? b : a;
    console.log(`병합: "${a.title}" vs "${b.title}" -> 제거: "${loser.title}" [${loser.source}/${loser.severity}]`);
    toDelete.push(loser.id);
  }

  if (toDelete.length === 0) {
    console.log("삭제 대상 없음, 중단");
    return;
  }

  await db.newsEvent.deleteMany({ where: { id: { in: toDelete } } });
  console.log(`\nNewsEvent ${toDelete.length}건 삭제 완료`);

  // --- 8/7 리포트 재계산 (reapply-news-calibration.ts와 동일 패턴, 8/7 하루만) ---
  const existing = await db.dailyReport.findUnique({ where: { date } });
  if (!existing) {
    console.log("8/7 리포트 없음, 재계산 생략");
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
    `\n8/7 리포트 갱신 완료 — 뉴스위험점수 ${fresh.step1.newsRiskScore.toFixed(1)}, 거부권: ${step8.vetoApplied ? "적용" : "미적용"}, 결론: ${step8.finalDecision}`
  );
  console.log("\n--- 새 narrative ---");
  console.log(narrative);
}

main().then(() => db.$disconnect());
