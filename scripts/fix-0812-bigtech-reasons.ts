// 8/13 리포트(marketDate 8/12) 5단계 빅테크 원인 정정.
//
// 사용자가 "5단계 빅테크 변동 원인 없는 이유"를 물어봐 조사한 결과, 처음 확인했을 때 화면(및
// get_page_text)엔 7종목 전부 "명확한 원인 확인 안 됨"으로 떴지만, DB(DailyReport.details)를
// 직접 조회하니 이미 6/7(AAPL 제외)에 원인이 채워져 있었다 — Vercel 페이지 캐시가 초기(원인 판정
// 전) 스냅샷을 잠깐 보여준 것으로 추정, 실제 파이프라인엔 파싱 실패 같은 버그가 없었다(코드 수정
// 안 함).
//
// 다만 채워진 원인 중 웹 검색으로 실제 그날 기사를 대조해보니 2건은 사실과 반대/모순됐다:
// - MSFT: "목표주가 상향" 때문이라고 써놨는데 실제로는 -2.26% 하락 — 상향과 하락은 논리적으로
//   안 맞는다. 실제 원인은 AI 트레이드가 소프트웨어보다 하드웨어를 선호하는 순환매(실적 자체는
//   매출·EPS 다 예상 상회).
// - AMZN: "실적이 기대에 못 미쳐 하락"이라고 써놨는데 실제로는 실적 랠리로 시총 3조 달러 첫 돌파
//   후 차익실현 매물로 하락 — 정반대 서술.
// META·NVDA는 기존 원인이 틀리진 않았지만(각각 진짜 있었던 기사 기반) 더 구체적인 실제 원인
// (메타: 실적 EPS 미스+capex 가이던스 상향+독일 소송, 엔비디아: 대형 금융사 6곳과 5천억 달러
// AI 인프라 자금조달 MOU)으로 교체 — 웹 검색(2026-08-14 수행)으로 확인.
// AAPL·GOOGL·TSLA는 그대로 둔다 — AAPL은 특정 원인을 못 찾았고(정직하게 "확인 안 됨" 유지),
// GOOGL·TSLA는 기존 원인이 사실과 모순되지 않아 근거 없이 다시 쓰지 않는다(데이터 정직성 원칙).
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";

const CORRECTIONS: Record<string, { oldReason: string; newReason: string }> = {
  MSFT: {
    oldReason: "오늘 분석가들이 마이크로소프트의 목표 주가를 상향 조정했다는 소식이 발표되었습니다",
    newReason: "오늘 견조한 실적 발표(매출·EPS 모두 예상 상회)에도 AI 관련 자금이 소프트웨어보다 하드웨어 종목으로 쏠리는 순환매 흐름 속에 하락했습니다",
  },
  AMZN: {
    oldReason: "오늘 발표된 아마존의 최신 실적이 투자자 기대에 미치지 못해 주가가 하락했습니다",
    newReason: "오늘 실적 발표 후 시가총액 3조 달러를 처음 돌파한 랠리 이후 차익실현 매물이 나오며 하락했습니다",
  },
  NVDA: {
    oldReason: "오늘 여러 애널리스트가 엔비디아 주식에 대한 강력한 매수 의견과 장기적인 성장 가능성을 강조했습니다",
    newReason: "오늘 아폴로·블랙록·블랙스톤 등 대형 금융사 6곳과 5천억 달러 규모의 AI 인프라 자금조달 MOU를 체결했다는 소식에 상승했습니다",
  },
  META: {
    oldReason: "오늘 메타가 ‘오픈 웨이트’ AI 전략을 재확인했지만, 투자자들은 이에 대한 수익성 우려를 표시했습니다",
    newReason: "오늘 실적에서 주당순이익이 시장 예상을 밑돌고 AI 인프라 투자 확대로 연간 지출 가이던스가 상향된 데다 독일에서 스마트글래스 개인정보 관련 소송까지 제기됐다는 소식이 겹치며 하락했습니다",
  },
};

async function main() {
  const date = new Date("2026-08-13T00:00:00.000Z");
  const existing = await db.dailyReport.findUnique({ where: { date } });
  if (!existing) {
    console.log("8/13 리포트 없음, 중단");
    return;
  }

  const details = existing.details as any;
  if (!details?.step5BigTech || !details?.step5Summary) {
    console.log("step5BigTech/step5Summary 없음, 중단");
    return;
  }

  let changed = 0;
  const step5BigTech = (details.step5BigTech as { label: string; value: string; criterion: string; met: null }[]).map((row) => {
    for (const [ticker, { oldReason, newReason }] of Object.entries(CORRECTIONS)) {
      if (row.label.includes(`(${ticker})`) && row.value.includes(oldReason)) {
        changed++;
        return { ...row, value: row.value.replace(oldReason, newReason) };
      }
    }
    return row;
  });

  if (changed !== Object.keys(CORRECTIONS).length) {
    console.log(`경고: ${Object.keys(CORRECTIONS).length}건 중 ${changed}건만 매칭됨 — 기존 문자열이 예상과 다를 수 있음. 중단.`);
    return;
  }

  let step5Summary = details.step5Summary as string;
  const metaOld = CORRECTIONS.META.oldReason;
  const metaNew = CORRECTIONS.META.newReason;
  if (!step5Summary.includes(metaOld)) {
    console.log("경고: step5Summary에서 메타 기존 원인 문장을 못 찾음 — 중단.");
    return;
  }
  step5Summary = step5Summary.replace(metaOld, metaNew);

  const newDetails = { ...details, step5BigTech, step5Summary };

  // comprehensiveReport는 step5BigTech(원인 포함)를 읽고 등락폭·원인이 뚜렷한 종목을 언급하라고
  // 지시받으므로, 원인 텍스트가 바뀐 이상 다시 생성해야 사실이 일치한다(narrative는 step1~8 raw
  // JSON만 보고 details/원인 텍스트를 안 봐서 영향 없음 — 재생성 생략).
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
  await db.dailyReport.update({
    where: { date },
    data: { details: asJson(finalDetails) },
  });

  console.log(`완료 — step5BigTech ${changed}건, step5Summary, comprehensiveReport 갱신.`);
}

main().then(() => db.$disconnect());
