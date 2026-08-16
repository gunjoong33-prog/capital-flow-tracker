// 사용자가 "오늘의 리포트의 종합보고서, 종합판단을 비전공자가 읽어도 바로 이해할 수 있는 수준으로
// 작성 — 코드 재설정 및 지금까지의 보고서 전면 수정"을 명시적으로 요청(2026-08-16). run.ts의
// summarizeStep2~4(종합판단 문장)에 RRP/TGA/크레딧 스프레드/캐리 트레이드/사분면/Risk-On·Off 등
// 전문용어 풀이를 추가한 커밋(cd058d1) 이후, 이미 저장된 과거 16건의 DailyReport를 전부 재계산한다.
//
// fix-0807-dedup-and-regen.ts와 정확히 같은 패턴 — step2/3/4는 asOf로 안전하게 재구성 가능해서
// 새 종합판단 문구가 자동으로 반영된다. step5/6/7Summary(빅테크 원인·섹터·기관매집은 "지금" 시점
// 라이브 데이터에 의존해 과거로 재구성이 구조적으로 불가능 — asof_backfill 문서 확인)는 원문 그대로
// 보존한다(이 스크립트가 손대는 범위 밖). VIX/공포탐욕지수/%ile 같은 step5~7의 소소한 용어 풀이는
// 이번 소급 재계산에는 반영되지 않고, 앞으로 생성되는 새 리포트부터 자동 반영된다 — 데이터 정직성
// 원칙상 라이브 전용 데이터를 과거 날짜로 위장해 재구성하지 않는다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { runDailyAnalysis } from "../src/lib/scoring/run";
import { generateNarrative, buildDailyNarrativePrompt } from "../src/lib/narrative";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";
import { scoreStep8, WEIGHTS, TOTAL_WEIGHT } from "../src/lib/scoring/pure";
import type { Step5Result, Step6Result, Step7Result, StepDetails } from "../src/lib/scoring/types";

async function regenOne(date: Date) {
  const dateStr = date.toISOString().slice(0, 10);
  const existing = await db.dailyReport.findUnique({ where: { date } });
  if (!existing) {
    console.log(`${dateStr}: 리포트 없음, 건너뜀`);
    return;
  }

  const asOf = existing.createdAt;
  const fresh = await runDailyAnalysis({ sectors: [] }, asOf);

  const originalStep5 = existing.step5 as unknown as Step5Result;
  const originalStep6 = existing.step6 as unknown as Step6Result;
  const originalStep7 = existing.step7 as unknown as Step7Result;
  const originalDetails = (existing.details ?? {}) as unknown as StepDetails;

  const step8 = scoreStep8({
    step1: fresh.step1, step2: fresh.step2, step3: fresh.step3, step4: fresh.step4,
    step5: originalStep5, step6: originalStep6, step7: originalStep7,
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

  console.log(`${dateStr}: 갱신 완료 — 결론 ${step8.finalDecision}, 점수 ${step8.macroTrendScore.toFixed(2)}`);
}

async function main() {
  const rows = await db.dailyReport.findMany({ select: { date: true }, orderBy: { date: "asc" } });
  console.log(`대상 ${rows.length}건`);
  for (const row of rows) {
    await regenOne(row.date);
  }
}

main().then(() => db.$disconnect());
