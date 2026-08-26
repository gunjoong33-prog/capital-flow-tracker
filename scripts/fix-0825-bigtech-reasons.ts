// 2026-08-25 리포트(marketDate 2026-08-24) 5단계 빅테크 원인 정정.
//
// 사용자가 "8/24~8/25 리포트 5단계 빅테크 7 변동원인이 전부 '명확한 원인 확인 안 됨'으로 뜬다"고
// 보고해 조사한 결과, bigtech-reasons.ts(2026-08-22 커밋)가 7종목을 한 프롬프트에 묶어 Groq를 한
// 번만 호출하는 구조라서, 그때 늘린 maxTokens(8192)와 헤드라인 개수(종목당 6개)가 겹치며 프롬프트+
// maxTokens 합이 이 조직의 Groq(gpt-oss-120b) 분당 토큰 한도(TPM 8000)를 항상 넘어 413으로 실패하는
// 새 회귀 버그를 확정(sourceErrors에 "Request too large ... TPM: Limit 8000, Requested 10881" 기록
// 확인). 종목별 개별 호출로 바꾸는 코드 수정 후, 그 수정된 함수로 실제 2026-08-24 헤드라인을 다시
// 조회해 받은 결과로 정정한다(fix-0818-0820과 달리 수동 웹서치 대조가 아니라, 고쳐진 파이프라인을
// 그대로 재실행한 결과 — AMZN·NVDA는 재실행에서도 "명확한 원인 확인 안 됨"으로 나와 손대지 않음,
// 데이터 정직성 원칙).
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";

const OLD_UNRESOLVED = "명확한 원인 확인 안 됨";

const CORRECTIONS: Record<string, string> = {
  AAPL: "오늘 애플이 AI 업그레이드가 적용된 새로운 맥 모델을 공개했기 때문입니다.",
  MSFT: "클라우드 AI 수요 증가와 메타가 주요 고객으로 확대된 소식이 투자 심리를 자극했습니다.",
  GOOGL: "구글이 MediaTek과 차세대 AI 칩을 공동 개발한다는 소식이 발표되었습니다.",
  META: "오늘 메타 주가가 AI 활용 기대감과 긍정적인 애널리스트 전망으로 상승했습니다.",
  TSLA:
    "머스크가 트럼프와 함께 중국을 방문하는 사이 FSD(완전 자율주행) 지연이 테슬라 최대 공장에 위협이 된다는 보도가 오늘 나오며 하락했습니다.",
};

async function main() {
  const date = new Date("2026-08-25T00:00:00.000Z");
  const existing = await db.dailyReport.findUnique({ where: { date } });
  if (!existing) {
    console.log("2026-08-25: 리포트 없음, 중단");
    return;
  }

  const details = existing.details as any;
  if (!details?.step5BigTech || !details?.step5Summary) {
    console.log("2026-08-25: step5BigTech/step5Summary 없음, 중단");
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
    console.log(`2026-08-25: 경고 — ${Object.keys(CORRECTIONS).length}건 중 ${changed}건만 매칭됨. 중단.`);
    return;
  }

  // topBigTechMover는 이 날 |변동률| 최대인 TSLA(-3.83%) — summarizeStep5의 isUnresolved 분기(단일
  // 문장) → false 분기(두 문장: 라벨/등락 + 원인)로 바뀐다(scoring/run.ts:346-357과 동일 로직 재현).
  const unresolvedLine = "빅테크 7 중 가장 크게 움직인 종목은 테슬라(-3.83%)이나, 뚜렷한 원인은 확인되지 않았습니다.";
  let step5Summary = details.step5Summary as string;
  if (!step5Summary.includes(unresolvedLine)) {
    console.log("2026-08-25: 경고 — step5Summary에서 topMover 문장을 못 찾음. 중단.");
    return;
  }
  const replacement = `빅테크 7 중 가장 크게 움직인 종목은 테슬라(-3.83%)입니다.\n${CORRECTIONS.TSLA}`;
  step5Summary = step5Summary.replace(unresolvedLine, replacement);

  const newDetails = { ...details, step5BigTech, step5Summary };

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

  console.log(`2026-08-25: 완료 — step5BigTech ${changed}건, step5Summary 갱신, comprehensiveReport 갱신.`);
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
