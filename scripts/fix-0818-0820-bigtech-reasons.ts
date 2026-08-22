// 8/18 리포트(marketDate 8/17)·8/20 리포트(marketDate 8/19) 5단계 빅테크 원인 정정.
//
// 사용자가 "8/18 전부, 8/19~8/22 일부 5단계 빅테크 원인이 명확한 원인 확인 안 됨으로 뜬다"고
// 보고해 조사한 결과, bigtech-reasons.ts의 Groq JSON 파싱이 실패하면 에러 기록 없이 조용히 빈
// 객체를 반환해 그날 7종목 전부가 동일 문구로 채워지는 코드 버그를 확정(2026-08-22 커밋으로 수정:
// maxTokens 4096→8192, 파싱 실패 시 throw). 실제 당시 뉴스와 웹 검색으로 교차검증한 결과, 아래
// 2건은 시스템이 뉴스를 놓친 게 확인됨(등락폭이 큰데도 진짜 원인 기사가 있었음) — 나머지는 실제로
// 개별 뉴스가 없었던 정직한 판정이라 손대지 않는다(데이터 정직성 원칙, fix-0812-bigtech-reasons.ts와
// 동일 원칙: 근거 없는 종목은 그대로 "확인 안 됨" 유지).
// - MSFT(8/18 리포트): -3.04% — 가디언 탐사보도(AI 인프라용 첨단칩 확보 의혹) + 모건스탠리 AI 산업
//   경고 리포트로 소프트웨어 대형주 매도.
// - META(8/18 리포트): -3.54% — 캘리포니아 등 29개 주 검찰의 미성년자 보호 소홀 재판 시작 + AI
//   투자비용 급증(전년비 55%↑)으로 영업이익률 43%→31% 하락.
// - AAPL(8/20 리포트): +2.19% — EU 앱스토어 Core Technology Fee(건당 수수료) 폐지, 거래액의
//   단순 5%로 대체하는 규정 완화 발표로 규제 리스크 완화 기대.
// (웹 검색 소스: Invezz·TradingKey·Benzinga·TipRanks·MacDailyNews, 2026-08-22 조사)
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";

interface DateFix {
  date: string; // report.date (YYYY-MM-DD, UTC 자정)
  corrections: Record<string, { oldReason: string; newReason: string }>;
  // topBigTechMover가 이 날짜의 수정 대상 티커면 step5Summary의 "뚜렷한 원인은 확인되지 않았습니다"
  // 문장도 같이 갈아끼워야 한다(run.ts:339-349 summarizeStep5 로직과 동일 문구를 그대로 재현).
  topMoverFix?: { unresolvedLine: string; label: string; pct: string; reason: string };
}

const OLD_UNRESOLVED = "명확한 원인 확인 안 됨";

const FIXES: DateFix[] = [
  {
    date: "2026-08-18",
    corrections: {
      MSFT: {
        oldReason: OLD_UNRESOLVED,
        newReason:
          "오늘 가디언지의 탐사보도로 AI 인프라 확장에 필요한 첨단 반도체를 충분히 확보했는지에 대한 의혹이 제기되고, 모건스탠리가 AI 산업 전반에 대한 경고 리포트를 내놓으며 소프트웨어 대형주 매도세가 나타나 하락했습니다.",
      },
      META: {
        oldReason: OLD_UNRESOLVED,
        newReason:
          "오늘 캘리포니아 등 29개 주 검찰이 제기한 미성년자 보호 소홀 관련 재판이 시작되고, AI 투자 비용 급증(전년 대비 55% 증가)으로 영업이익률이 43%에서 31%로 낮아졌다는 우려가 겹치며 하락했습니다.",
      },
    },
    // topBigTechMover는 이 날 |변동률| 최대인 META(-3.54%, MSFT -3.04%보다 큼) — run.ts:343의
    // isUnresolved 분기(단일 문장) → false 분기(두 문장: 라벨/등락 + 원인)로 바뀐다.
    topMoverFix: {
      unresolvedLine: "빅테크 7 중 가장 크게 움직인 종목은 메타(-3.54%)이나, 뚜렷한 원인은 확인되지 않았습니다.",
      label: "메타",
      pct: "-3.54%",
      reason:
        "오늘 캘리포니아 등 29개 주 검찰이 제기한 미성년자 보호 소홀 관련 재판이 시작되고, AI 투자 비용 급증(전년 대비 55% 증가)으로 영업이익률이 43%에서 31%로 낮아졌다는 우려가 겹치며 하락했습니다.",
    },
  },
  {
    date: "2026-08-20",
    corrections: {
      AAPL: {
        oldReason: OLD_UNRESOLVED,
        newReason:
          "오늘 유럽연합이 앱스토어 건당 수수료(Core Technology Fee) 제도를 폐지하고 거래액의 단순 5% 수수료로 대체하는 규정 완화를 발표하면서 규제 리스크가 줄었다는 기대감에 상승했습니다.",
      },
    },
    // topBigTechMover는 이 날 TSLA(+4.23%, 이미 원인 있음, AAPL +2.19%보다 큼) — step5Summary는
    // AAPL을 언급하지 않으므로 topMoverFix 불필요.
  },
];

async function fixOne(fix: DateFix) {
  const date = new Date(`${fix.date}T00:00:00.000Z`);
  const existing = await db.dailyReport.findUnique({ where: { date } });
  if (!existing) {
    console.log(`${fix.date}: 리포트 없음, 건너뜀`);
    return;
  }

  const details = existing.details as any;
  if (!details?.step5BigTech || !details?.step5Summary) {
    console.log(`${fix.date}: step5BigTech/step5Summary 없음, 건너뜀`);
    return;
  }

  let changed = 0;
  const step5BigTech = (details.step5BigTech as { label: string; value: string; criterion: string; met: null }[]).map((row) => {
    for (const [ticker, { oldReason, newReason }] of Object.entries(fix.corrections)) {
      if (row.label.includes(`(${ticker})`) && row.value.endsWith(oldReason)) {
        changed++;
        return { ...row, value: row.value.slice(0, -oldReason.length) + newReason };
      }
    }
    return row;
  });

  if (changed !== Object.keys(fix.corrections).length) {
    console.log(`${fix.date}: 경고 — ${Object.keys(fix.corrections).length}건 중 ${changed}건만 매칭됨. 건너뜀.`);
    return;
  }

  let step5Summary = details.step5Summary as string;
  if (fix.topMoverFix) {
    if (!step5Summary.includes(fix.topMoverFix.unresolvedLine)) {
      console.log(`${fix.date}: 경고 — step5Summary에서 topMover 문장을 못 찾음. 건너뜀.`);
      return;
    }
    const replacement = `빅테크 7 중 가장 크게 움직인 종목은 ${fix.topMoverFix.label}(${fix.topMoverFix.pct})입니다.\n${fix.topMoverFix.reason}`;
    step5Summary = step5Summary.replace(fix.topMoverFix.unresolvedLine, replacement);
  }

  const newDetails = { ...details, step5BigTech, step5Summary };

  // comprehensiveReport는 step5BigTech(원인 포함)를 읽고 서술하므로 원인 텍스트가 바뀐 이상
  // 다시 생성해야 사실이 일치한다(fix-0812-bigtech-reasons.ts와 동일 원칙 — narrative는 step1~8
  // raw JSON만 보고 details를 안 봐서 영향 없음, 재생성 생략).
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

  console.log(`${fix.date}: 완료 — step5BigTech ${changed}건, step5Summary${fix.topMoverFix ? "(갱신)" : "(변경없음)"}, comprehensiveReport 갱신.`);
}

async function main() {
  for (const fix of FIXES) await fixOne(fix);
}

main().then(() => db.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
