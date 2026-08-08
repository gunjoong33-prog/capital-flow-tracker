// 8/4~8/8 종합보고서 재작성 — forwardSignals.quadrantExit(사분면 이동 힌트 하드코딩)·
// distanceToThresholds(임계값 문자열 미리 조립)·riskyNewsCount(뉴스 건수 필드 추가) 세 가지 버그
// 수정을 반영해 종합보고서(comprehensiveReport)만 다시 쓴다.
//
// *** 중요: runDailyAnalysis(asOf)로 실시간 재계산하지 않는다 ***
// 처음엔 asOf를 넘겨 step2·3·4·8을 다시 계산하려 했으나, 8/4 실측 결과 사분면 자체가
// "금↓실질금리↑"→"금↑실질금리↑"로 바뀌고 최종점수가 3.11→2.65로 틀어지는 걸 확인했다 — 지표
// 시계열이 원본 계산 이후 나중에 업서트(백필 등)로 갱신되면서 asOf 필터만으로는 "그 시점에 실제로
// 알려졌던 값"을 안전하게 재현하지 못한다(고용지표 이벤트 결과도 같은 이유로 8/7 리포트에 8/7 발표가
// 아직 안 나왔어야 하는데도 값이 잡히는 걸 확인 — observation date만으로 필터링해 발표 전 데이터가
// 새어 들어가는 사각지대가 있다). 그래서 이번엔 이미 저장된(원본 파이프라인이 실제로 그 순간 계산해
// DB에 박아둔) step1~8·details를 그대로 두고, forwardSignals만 그 안에 이미 있는 숫자로 순수하게
// 재조립한다 — 어떤 지표도 다시 조회하지 않는다.
//
// 고용지표 실제 결과(step1.recentEventOutcomes)는 원본 매그니튜드(8/7 "57.0", 8/8 "-126.0")를
// 그대로 두되(이 숫자 자체가 맞는지는 별도 조사가 필요한 지표 수집 파이프라인 문제로 보임 — 이번
// 수정 범위 밖), 단위 표기만 "명"으로 붙여 LLM이 배율을 잘못 해석할 여지를 없앤다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";
import type { Direction, Step1Result, Step2Result, Step3Result, Step4Result, Step5Result, Step6Result, Step7Result, Step8Result, StepDetails, StepDetailRow } from "../src/lib/scoring/types";

const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_DATE = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const DATES = ONLY_DATE ? [ONLY_DATE] : ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"];

const QUADRANT_SCORE_TABLE: Record<string, number> = {
  "금↑ 실질금리↑": 2,
  "금↑ 실질금리↓/보합": 5,
  "금↓ 실질금리↑": 10,
  "금↓ 실질금리↓/보합": 3,
};

/** 저장된 사분면 문자열을 gold/rate 방향으로 역파싱한다(라이브 조회 없이 순수 문자열 파싱). */
function parseQuadrant(quadrant: string): { gold: Direction; rate: Direction } {
  const gold: Direction = quadrant.startsWith("금↑") ? "up" : "down";
  const rate: Direction = quadrant.includes("실질금리↑") ? "up" : "down";
  return { gold, rate };
}

function quadrantLabel(gold: Direction, rate: Direction): string {
  if (gold === "up" && rate === "up") return "금↑ 실질금리↑";
  if (gold === "up") return "금↑ 실질금리↓/보합";
  if (rate === "up") return "금↓ 실질금리↑";
  return "금↓ 실질금리↓/보합";
}

/**
 * 축 하나만 반대로 뒤집었을 때 도착하는 사분면·점수를 계산한다. 텀프리미엄 조정(현재 상태에서만
 * 판단 가능한 us30yPercentile·달러 디커플링 조합)은 가상 시나리오에는 적용하지 않고 기본 점수표만
 * 쓴다 — run.ts의 quadrantScoreTable과 같은 표를 그대로 LLM에 전달하므로 일관된다.
 */
function describeFlip(axis: "gold" | "rate", gold: Direction, rate: Direction): string {
  const flip = (d: Direction): Direction => (d === "up" ? "down" : "up");
  const newGold = axis === "gold" ? flip(gold) : gold;
  const newRate = axis === "rate" ? flip(rate) : rate;
  const label = quadrantLabel(newGold, newRate);
  const score = QUADRANT_SCORE_TABLE[label];
  const axisLabel = axis === "gold" ? "금이" : "실질금리가";
  const directionLabel = axis === "gold" ? (newGold === "up" ? "상승" : "하락") : newRate === "up" ? "상승" : "하락";
  return `${axisLabel} ${directionLabel} 전환하면 '${label}'(${score}/10)로 이동`;
}

async function main() {
  for (const dateStr of DATES) {
    const date = new Date(dateStr);
    const existing = await db.dailyReport.findUnique({ where: { date } });
    if (!existing) {
      console.log(dateStr, "리포트 없음, 건너뜀");
      continue;
    }

    const step1 = existing.step1 as unknown as Step1Result;
    const step2 = existing.step2 as unknown as Step2Result;
    const step3 = existing.step3 as unknown as Step3Result;
    const step4 = existing.step4 as unknown as Step4Result;
    const step5 = existing.step5 as unknown as Step5Result;
    const step6 = existing.step6 as unknown as Step6Result;
    const step7 = existing.step7 as unknown as Step7Result;
    const step8 = existing.step8 as unknown as Step8Result;
    const details = (existing.details ?? {}) as unknown as StepDetails & {
      forwardSignals?: {
        liquidityCycle: { netLiquidityDirection: string; rrpBuffer: string; creditSpreadBp: number | null; creditLeadsEquity: string };
        upcomingEvents: string | null;
        distanceToThresholds: { carrySpreadBp: number; carrySafeGapBp: number; vixFearGapPt: number | null; creditNormalGapBp: number | null; scoreToWatchGap: number };
        institutionalDirection: string | null;
      };
    };

    const oldFs = details.forwardSignals;
    if (!oldFs) {
      console.log(dateStr, "forwardSignals 없음, 건너뜀");
      continue;
    }

    // 고용지표 등 실제 결과 문구 — 매그니튜드는 원본 보존, 단위만 "명"으로 명확히 붙인다(천 명 단위 값을
    // LLM이 이미 "명" 단위인 것처럼 잘못 환산하지 못하게). NFP 원본 매그니튜드 자체의 정확성(8/7 "+57,000명",
    // 8/8 "-126,000명"이 실제 BLS 발표치와 다른 것으로 보이는 문제)은 지표 수집 파이프라인 조사가 별도로
    // 필요해 이번 수정 범위에 포함하지 않는다.
    const relabelDetail = (detail: string): string =>
      detail.replace(/변화량 (-?\d+(?:\.\d+)?)\s*\(/, (_m, num: string) => `변화량 ${Math.round(Number(num) * 1000).toLocaleString("en-US")}명 (`);

    const patchedEventOutcomes = (step1.recentEventOutcomes ?? []).map((o) => ({
      ...o,
      detail: /^변화량 -?\d/.test(o.detail) ? relabelDetail(o.detail) : o.detail,
    }));

    const mixedStep1 = {
      ...step1,
      recentEventOutcomes: patchedEventOutcomes,
      riskyNewsCount: (step1.riskyNews ?? []).length,
    };

    const mixedDetailsStep1: StepDetailRow[] = (details.step1 ?? []).map((row) => {
      const match = patchedEventOutcomes.find((o) => row.label.startsWith(o.name) && row.label.includes("실제 결과"));
      return match ? { ...row, value: match.detail } : row;
    });

    const { gold, rate } = parseQuadrant(step4.quadrant);
    const newForwardSignals = {
      liquidityCycle: oldFs.liquidityCycle,
      upcomingEvents: oldFs.upcomingEvents,
      quadrantExit: {
        current: `${step4.quadrant} — 점수 ${step4.score}/10`,
        ifGoldFlips: describeFlip("gold", gold, rate),
        ifRateFlips: describeFlip("rate", gold, rate),
      },
      quadrantScoreTable: QUADRANT_SCORE_TABLE,
      distanceToThresholds: {
        carrySafeMargin: `현재 ${oldFs.distanceToThresholds.carrySpreadBp}bp, 안전 마진 350bp까지 ${oldFs.distanceToThresholds.carrySafeGapBp}bp 남음`,
        vixFearMargin:
          oldFs.distanceToThresholds.vixFearGapPt !== null
            ? `현재 ${(25 - oldFs.distanceToThresholds.vixFearGapPt).toFixed(2)}, 공포 구간 25까지 ${oldFs.distanceToThresholds.vixFearGapPt.toFixed(2)}pt 남음`
            : "확인 못함",
        creditNormalMargin:
          oldFs.distanceToThresholds.creditNormalGapBp !== null
            ? `현재 ${oldFs.liquidityCycle.creditSpreadBp}bp, 정상 수준 300bp까지 ${oldFs.distanceToThresholds.creditNormalGapBp}bp 남음`
            : "확인 못함",
        scoreToWatchMargin: `현재 ${step8.macroTrendScore.toFixed(2)}점, 지켜보기 기준 5.0점까지 ${oldFs.distanceToThresholds.scoreToWatchGap.toFixed(2)}점 모자람`,
      },
      institutionalDirection: oldFs.institutionalDirection,
    };

    const mixedDetails: StepDetails = {
      ...details,
      step1: mixedDetailsStep1,
      forwardSignals: newForwardSignals,
    };

    const reportForNarrative = { step1: mixedStep1, step2, step3, step4, step5, step6, step7, step8, details: mixedDetails };

    let comprehensiveReport: string;
    try {
      comprehensiveReport = await generateComprehensiveReport(reportForNarrative);
    } catch (err) {
      console.error(dateStr, "종합보고서 생성 실패:", err instanceof Error ? err.message : String(err));
      continue;
    }
    mixedDetails.comprehensiveReport = comprehensiveReport;

    if (DRY_RUN) {
      console.log(`=== ${dateStr} (dry-run, DB에 쓰지 않음) ===`);
      console.log("quadrantExit:", JSON.stringify(newForwardSignals.quadrantExit));
      console.log("distanceToThresholds:", JSON.stringify(newForwardSignals.distanceToThresholds));
      console.log(comprehensiveReport);
      console.log();
      continue;
    }

    const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
    await db.dailyReport.update({
      where: { date },
      data: {
        step1: asJson(mixedStep1),
        details: asJson(mixedDetails),
      },
    });
    console.log(`${dateStr} 재작성 완료 (step2/3/4/8은 변경하지 않음, step1·details·comprehensiveReport만 갱신)`);
  }
}

main().then(() => db.$disconnect());
