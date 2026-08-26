// 2026-08-26 리포트(marketDate 2026-08-25) 5단계 빅테크 원인 정정.
//
// fix-0825-bigtech-reasons.ts와 같은 413(TPM 초과) 버그의 여파 — 이 리포트를 만든 크론은
// 2026-08-25T23:52 UTC(=2026-08-26 08:52 KST)에 돌았는데, 그 413 회귀를 고친 커밋(337b7ee)은
// 그보다 나중(2026-08-26 오전 중, 이 스크립트 작성 시점)에 배포됐다 — 그래서 8/25 리포트는
// 손대지 않았는데도 여전히 옛 버그(413으로 실패 → 7종목 전부 "명확한 원인 확인 안 됨")를 갖고
// 있었다. 이제 배포된 고쳐진 코드로 marketDate 2026-08-25를 재실행해 받은 진짜 결과로 정정한다.
// MSFT·NVDA·META는 재실행에서도 "명확한 원인 확인 안 됨"으로 나와 손대지 않음(데이터 정직성 원칙).
// topBigTechMover는 이 날 NVDA(+2.19%, 절대값 최대)인데 NVDA도 원인 미확인이라 step5Summary의
// "뚜렷한 원인은 확인되지 않았습니다" 문장은 그대로 맞다 — topMoverFix 불필요.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";

const OLD_UNRESOLVED = "명확한 원인 확인 안 됨";

const CORRECTIONS: Record<string, string> = {
  AAPL: "오늘 애플이 AI 업그레이드된 신형 맥을 공개했으나 이미 가격에 반영돼 주가가 소폭 하락했습니다.",
  GOOGL: "애널리스트가 구글이 차세대 AI 칩을 개발 중이라고 언급하면서 투자자들의 기대가 조정돼 주가가 하락했습니다.",
  AMZN: "아마존 CEO와 고위 임원들의 대규모 주식 매도가 투자자들의 우려를 불러와 주가가 하락했습니다.",
  TSLA: "테슬라가 기존 차량에 대규모 FSD(Full Self-Driving) 업데이트를 제공한다는 소식이 전해져 주가가 상승했습니다.",
};

async function main() {
  const date = new Date("2026-08-26T00:00:00.000Z");
  const existing = await db.dailyReport.findUnique({ where: { date } });
  if (!existing) {
    console.log("2026-08-26: 리포트 없음, 중단");
    return;
  }

  const details = existing.details as any;
  if (!details?.step5BigTech || !details?.step5Summary) {
    console.log("2026-08-26: step5BigTech/step5Summary 없음, 중단");
    return;
  }

  let changed = 0;
  const step5BigTech = (details.step5BigTech as { label: string; value: string; criterion: string; met: null }[]).map(
    (row) => {
      for (const [ticker, newReason] of Object.entries(CORRECTIONS)) {
        if (row.label.includes(`(${ticker})`) && row.value.endsWith(OLD_UNRESOLVED)) {
          changed++;
          return { ...row, value: row.value.slice(0, -OLD_UNRESOLVED.length) + newReason };
        }
      }
      return row;
    }
  );

  if (changed !== Object.keys(CORRECTIONS).length) {
    console.log(`2026-08-26: 경고 — ${Object.keys(CORRECTIONS).length}건 중 ${changed}건만 매칭됨. 중단.`);
    return;
  }

  // topBigTechMover(NVDA)는 여전히 원인 미확인이라 step5Summary는 안 바뀐다.
  const newDetails = { ...details, step5BigTech };

  const comprehensiveReport = await generateComprehensiveReport({
    step1: existing.step1,
    step2: existing.step2,
    step3: existing.step3,
    step4: existing.step4,
    step5: existing.step5,
    step6: existing.step6,
    step7: existing.step7,
    step8: existing.step8,
    details: newDetails,
  });
  const finalDetails = { ...newDetails, comprehensiveReport };

  const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
  await db.dailyReport.update({ where: { date }, data: { details: asJson(finalDetails) } });

  console.log(`2026-08-26: 완료 — step5BigTech ${changed}건, comprehensiveReport 갱신.`);
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
