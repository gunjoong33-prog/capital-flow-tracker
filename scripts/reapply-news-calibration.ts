// recalibrate-news-severity.ts로 NewsEvent.severity를 강제 재작성한 뒤(사용자가 명시 선택한 예외
// 조치), 그 영향을 받는 리포트의 1단계(뉴스 리스크·거부권)와 8단계(거부권이 최종 결론에 영향)를
// 다시 계산한다. reapply-scoring-fixes.ts와 달리 이번엔 step1도 원본 보존하지 않고 새로 계산한다
// (원칙에서 벗어난 예외적 소급 반영이라는 걸 알고 쓸 것) — 5·6·7단계(라이브 전용, 재구성 불가)만
// 원본 보존.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { runDailyAnalysis } from "../src/lib/scoring/run";
import { scoreStep8, WEIGHTS, TOTAL_WEIGHT } from "../src/lib/scoring/pure";
import type { Step5Result, Step6Result, Step7Result, StepDetails } from "../src/lib/scoring/types";

async function main() {
  const reports = await db.dailyReport.findMany({ orderBy: { date: "asc" } });

  for (const existing of reports) {
    const dateStr = existing.date.toISOString().slice(0, 10);
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
      {
        label: `2단계 유동성 (가중치 ${WEIGHTS.step2})`,
        criterion: "가중 반영",
        value: `${fresh.step2.finalScore.toFixed(2)} × ${WEIGHTS.step2} = ${(fresh.step2.finalScore * WEIGHTS.step2).toFixed(2)}`,
        met: null,
      },
      {
        label: `3단계 캐리 트레이드 (가중치 ${WEIGHTS.step3})`,
        criterion: "가중 반영",
        value: `${fresh.step3.score.toFixed(2)} × ${WEIGHTS.step3} = ${(fresh.step3.score * WEIGHTS.step3).toFixed(2)}`,
        met: null,
      },
      {
        label: `4단계 환율·금·유가 (가중치 ${WEIGHTS.step4})`,
        criterion: "가중 반영",
        value: `${fresh.step4.score.toFixed(2)} × ${WEIGHTS.step4} = ${(fresh.step4.score * WEIGHTS.step4).toFixed(2)}`,
        met: null,
      },
      {
        label: `5단계 자금 도착 (가중치 ${WEIGHTS.step5})`,
        criterion: "가중 반영",
        value: `${originalStep5.score.toFixed(2)} × ${WEIGHTS.step5} = ${(originalStep5.score * WEIGHTS.step5).toFixed(2)}`,
        met: null,
      },
      {
        label: `6단계 섹터 (가중치 ${WEIGHTS.step6})`,
        criterion: "가중 반영",
        value: `${originalStep6.score.toFixed(2)} × ${WEIGHTS.step6} = ${(originalStep6.score * WEIGHTS.step6).toFixed(2)}`,
        met: null,
      },
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

    const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
    await db.dailyReport.update({
      where: { date: existing.date },
      data: {
        step1: asJson(fresh.step1),
        step2: asJson(fresh.step2),
        step3: asJson(fresh.step3),
        step4: asJson(fresh.step4),
        step8: asJson(step8),
        details: asJson(details),
      },
    });

    console.log(
      `${dateStr} 갱신 완료 — 뉴스위험점수 ${fresh.step1.newsRiskScore.toFixed(1)}, 거부권: ${step8.vetoApplied ? "적용" : "미적용"}, 결론: ${step8.finalDecision}`
    );
  }
}

main().then(() => db.$disconnect());
