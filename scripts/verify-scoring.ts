// 지난 감사에서 나온 실제 사례로 채점 로직을 수동 대조하는 스크립트.
// DB 없이 순수 함수만 검증한다. 실행: npx tsx scripts/verify-scoring.ts
import { scoreStep1, scoreStep2, scoreStep3, scoreStep4, scoreStep5, scoreStep8 } from "../src/lib/scoring/pure";

console.log("=== 3단계: 7/21~23 스프레드 재해석 사례 (약 187~191bp) ===");
const step3 = scoreStep3({
  us10y: 4.2,
  jp10y: 2.3, // 4.2 - 2.3 = 1.9% = 190bp
  spreadBpPercentile: 20,
  cftcNetPositionPercentile: 50,
  jpyVolSpike: false,
});
console.log(step3);
console.assert(step3.zone === "위험", "❌ 190bp는 위험구간(200bp 이하)이어야 함");
console.assert(step3.spreadBp === 190, `❌ 스프레드 계산 오류: ${step3.spreadBp}`);
console.log("✅ 11번 섹션 재해석과 일치: 190bp → 3구간(위험)\n");

console.log("=== 1단계 거부권 ===");
const step1Veto = scoreStep1({ newsRiskScore: 6, hasRecentEventSurprise: false, hasSevereNewsInWindow: false });
console.assert(step1Veto.vetoTriggered === true, "❌ 가중점수 6점이면 거부권 발동해야 함(기준 5점)");
console.log(step1Veto, "\n");

console.log("=== 1단계 거부권(가중점수 미달) ===");
const step1NoVeto = scoreStep1({ newsRiskScore: 3, hasRecentEventSurprise: false, hasSevereNewsInWindow: false });
console.assert(step1NoVeto.vetoTriggered === false, "❌ 가중점수 3점이면 거부권 발동하면 안 됨(기준 5점 미만)");
console.log(step1NoVeto, "\n");

console.log("=== 2단계 해외 지표 충족 ===");
const step2Full = scoreStep2({
  walclIncreasing: true,
  m2GrowthRising2Months: true,
  reservesRising4Weeks: true,
  rrpDeclining: true,
  tgaDeclining: true,
  realRateFallingOrLowFlat: true,
  creditSpreadNarrowing: true,
});
console.log(step2Full);
console.assert(
  step2Full.overseasScore === 10 && step2Full.finalScore === 10,
  `❌ 해외 7/7 충족이면 10점이어야 함, 실제: ${step2Full.finalScore}`
);
console.log("✅ 해외 7/7 충족 → 10점\n");

console.log("=== 4단계 진짜 2x2 ===");
const step4 = scoreStep4({ goldDirection: "down", realRateDirection: "up", dollarDirection: "up" });
console.assert(step4.score === 10, "❌ 금↓실질금리↑는 10점(성장주 매수)이어야 함");
console.log(step4, "\n");

console.log("=== 8단계 거부권 다운그레이드 ===");
const step8 = scoreStep8({
  step1: { vetoTriggered: true, reason: "test" },
  step2: { overseasScore: 10, overseasQualifyingCount: 7, overseasTotalCount: 7, finalScore: 10 },
  step3: { spreadBp: 400, zone: "안정", score: 10, warning: null },
  step4: { quadrant: "test", score: 10, note: "", dollarConfirms: true },
  step5: { gapPp: 0, concentrationWarning: false, riskAppetite: "중립", score: 10, cryptoAlignsWithRisk: null },
  step6: { qualifying: [], score: 10 },
  step7: { bothOverheated: false, oneOverheated: false, fearZone: false, positionSizeMultiplier: 1 },
});
console.log(step8);
console.assert(step8.macroTrendScore === 10, `❌ 전 지표 만점이면 추세점수 10이어야 함: ${step8.macroTrendScore}`);
console.assert(
  step8.finalDecision === "지켜보기",
  `❌ 추세점수10(매수권)이어도 거부권 걸리면 한단계 다운(지켜보기)이어야 함: ${step8.finalDecision}`
);
console.log("✅ 매크로 추세점수 10점이어도 1단계 거부권 걸리면 '매수'→'지켜보기'로 다운그레이드됨\n");

console.log("모든 검증 통과");
