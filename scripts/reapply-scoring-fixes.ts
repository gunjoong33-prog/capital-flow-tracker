// backfill-historical-scoring.ts와 같은 원리(asOf 기준으로 2·3·4·8단계만 재계산, 1·5·6·7단계는
// 원본 보존) — 이번엔 특정 날짜 몇 개가 아니라 저장된 리포트 전체에 적용한다. P0~P2 채점 로직
// 수정(4단계 텀프리미엄 구분, 2단계 2Y-10Y 베어스티프닝, 크레딧 스프레드 문구, M2 허용오차)이
// 기존 리포트에도 반영되게 하려고 돌린다. 뉴스 캘리브레이션(P0-1)은 과거 NewsEvent 판정 자체를
// 다시 쓰지 않으므로(원본 LLM 판정 보존 원칙) 여기 대상이 아니다 — 앞으로의 판정부터 적용된다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { runDailyAnalysis } from "../src/lib/scoring/run";
import { scoreStep8, WEIGHTS, TOTAL_WEIGHT } from "../src/lib/scoring/pure";
import type { Step1Result, Step5Result, Step6Result, Step7Result, StepDetails } from "../src/lib/scoring/types";

async function main() {
  const reports = await db.dailyReport.findMany({ orderBy: { date: "asc" } });

  for (const existing of reports) {
    const dateStr = existing.date.toISOString().slice(0, 10);
    // createdAt = 그날 실제로 파이프라인이 돌았던 시점 — "그 시점에 알 수 있었던 최신값"을 재현.
    const asOf = existing.createdAt;

    const fresh = await runDailyAnalysis({ sectors: [] }, asOf);

    const originalStep1 = existing.step1 as unknown as Step1Result;
    const originalStep5 = existing.step5 as unknown as Step5Result;
    const originalStep6 = existing.step6 as unknown as Step6Result;
    const originalStep7 = existing.step7 as unknown as Step7Result;
    const originalDetails = (existing.details ?? {}) as unknown as StepDetails;

    const step8 = scoreStep8({
      step1: originalStep1,
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
        step2: asJson(fresh.step2),
        step3: asJson(fresh.step3),
        step4: asJson(fresh.step4),
        step8: asJson(step8),
        details: asJson(details),
      },
    });

    console.log(
      `${dateStr} 갱신 완료 — macroTrendScore ${step8.macroTrendScore.toFixed(3)}, 결론: ${step8.finalDecision}, 거부권: ${step8.vetoApplied ? "적용" : "미적용"}, 4단계 점수: ${fresh.step4.score}`
    );
  }
}

main().then(() => db.$disconnect());
