import type {
  Step1Input,
  Step1Result,
  Step2Input,
  Step2Result,
  Step3Input,
  Step3Result,
  Step4Input,
  Step4Result,
  Step5Input,
  Step5Result,
  Step6Input,
  Step6Result,
  Step7Input,
  Step7Result,
  Step8Input,
  Step8Result,
} from "./types";
import { NEWS_RISK_SCORE_THRESHOLD } from "./types";

// ── 1단계: 글로벌 환경 — 거부권 ─────────────────────────────
// 노션 v2 프롬프트 8단계 "1단계 거부권" 절 그대로. 여기에 "단독 즉시발동"(hasSevereNewsInWindow)과
// "건수 대신 가중점수"(newsRiskScore)를 추가했다 — 월가 GPR지수(Threats/Acts로 사건 성격 구분)와
// BlackRock BGRI(출처 신뢰도·최근성 가중)처럼, 실제 리스크 지표는 단순 건수가 아니라 심각도·출처·
// 최근성을 반영한다. 건수만 세면 유동성이 괜찮은 국면에서도 사소한 뉴스 3건만으로 오판할 수 있고,
// 반대로 전쟁 발발 같은 단일 사건은 다른 뉴스 2건이 더 나올 때까지 기다려야 하는 문제가 있었다.
// 가중점수 계산은 news-events.ts의 newsItemWeight()가 담당한다.
export function scoreStep1(input: Step1Input): Step1Result {
  const vetoTriggered =
    input.newsRiskScore >= NEWS_RISK_SCORE_THRESHOLD || input.hasRecentEventSurprise || input.hasSevereNewsInWindow;
  return {
    vetoTriggered,
    reason: vetoTriggered
      ? input.hasSevereNewsInWindow
        ? "최근 7일 내 단독으로도 시장을 크게 흔들 수준의 뉴스 발생"
        : input.newsRiskScore >= NEWS_RISK_SCORE_THRESHOLD
          ? `최근 7일 내 리스크 뉴스 가중점수 ${input.newsRiskScore.toFixed(1)}점(기준 ${NEWS_RISK_SCORE_THRESHOLD}점 이상)`
          : "최근 발표된 FOMC/CPI/고용지표 결과가 예상 밖(서프라이즈)"
      : "특이사항 없음",
  };
}

// ── 2단계: 유동성 ───────────────────────────────────────────
export function scoreStep2(input: Step2Input): Step2Result {
  const overseasFlags = [
    input.walclIncreasing,
    input.m2GrowthRising2Months,
    input.reservesRising4Weeks,
    input.rrpDeclining,
    input.tgaDeclining,
    input.realRateFallingOrLowFlat,
    input.creditSpreadNarrowing,
  ];
  const known = overseasFlags.filter((f) => f !== null) as boolean[];
  const qualifyingCount = known.filter(Boolean).length;
  const overseasScore = known.length > 0 ? (qualifyingCount / known.length) * 10 : 5;

  return {
    overseasScore,
    overseasQualifyingCount: qualifyingCount,
    overseasTotalCount: known.length,
    finalScore: overseasScore,
  };
}

// ── 3단계: 캐리 트레이드 ─────────────────────────────────────
// 구간표는 "실제 월가 표준 아님"(11번 참고) — 방향성 참고용으로만 쓰고,
// jpyVolSpike(엔화 변동성 급등)를 실제 청산 신호로 우선한다.
export function scoreStep3(input: Step3Input): Step3Result {
  const spreadBp = (input.us10y - input.jp10y) * 100;

  let zone: Step3Result["zone"];
  if (spreadBp >= 350) zone = "안정";
  else if (spreadBp >= 250) zone = "주의";
  else zone = "위험";

  const spreadScore = input.spreadBpPercentile ?? 50;
  // 순포지션 백분위: 값이 음수(숏)일수록 캐리 활발 → 부호를 뒤집어 "숏이 깊을수록 높은 점수"로 계산.
  // (엔화 순포지션이 줄어들기 시작 = 청산 신호라는 프롬프트 설명에 따른 해석 — 3단계 "실제 트레이더는 이렇게 본다" 참고)
  const positionScore = input.cftcNetPositionPercentile ?? 50;
  const score = (spreadScore + positionScore) / 2 / 10;

  return {
    spreadBp: Math.round(spreadBp),
    zone,
    score,
    warning: input.jpyVolSpike
      ? "엔화 변동성 급등 감지 — 스프레드 구간표보다 이 신호를 우선한다"
      : null,
  };
}

// ── 4단계: 금·실질금리·달러 (진짜 2x2) ───────────────────────
// 노션 페이지 "표 읽는 순서" 수정분 그대로: 실질금리를 1축, 금값을 1축으로 쓰고
// 달러는 보조 확인(같은 방향=신호 강함, 반대 방향=디커플링 경계)으로만 쓴다.
// 사분면별 점수는 원래 3변수 표(좋음10/보통5/나쁨0)의 취지를 2x2로 옮긴 것 —
// 본문에 숫자로 명시되지 않았던 부분이라 이식 시 직접 매긴 값임을 밝혀둔다.
export function scoreStep4(input: Step4Input): Step4Result {
  const { goldDirection: gold, realRateDirection: rate, dollarDirection: dollar } = input;
  let score: number;
  let quadrant: string;
  let note: string;

  if (gold === "up" && rate === "up") {
    score = 2;
    quadrant = "금↑ 실질금리↑";
    note = "흔치 않은 조합(인플레 우려+안전자산 수요 동시). 1단계부터 재확인 필요";
  } else if (gold === "up" && rate !== "up") {
    score = 5;
    quadrant = "금↑ 실질금리↓/보합";
    note = "안전자산 매력 유지, 위험도 커지는 중 — 원자재·가치주 유리";
  } else if (gold === "down" && rate === "up") {
    score = 10;
    quadrant = "금↓ 실질금리↑";
    note = "안전자산에서 금융자산으로 이동 중 — 성장주·기술주 유리";
  } else {
    score = 3;
    quadrant = "금↓ 실질금리↓/보합";
    note = "안전자산 매력도 하락, 위험선호도 약함(디플레·경기위축 우려일 수 있음)";
  }

  const dollarConfirms = dollar === rate;

  return { quadrant, score, note, dollarConfirms };
}

// ── 5단계: 규모별·성격별 자금 도착 ────────────────────────────
export function scoreStep5(input: Step5Input): Step5Result {
  const gapPp = input.ndxReturn20d - input.rutReturn20d;
  const concentrationWarning = Math.abs(gapPp) > 3;

  let riskAppetite: Step5Result["riskAppetite"] = "중립";
  if (input.djiReturn20d > input.spxReturn20d) riskAppetite = "안전선호";
  else if (input.spxReturn20d > input.djiReturn20d) riskAppetite = "위험선호";

  // 격차가 작을수록 높은 점수(= 100 - 백분위)
  const score = input.gapPercentile !== null ? (100 - input.gapPercentile) / 10 : 5;

  let cryptoAlignsWithRisk: boolean | null = null;
  if (input.btcReturn20d !== null) {
    const ndxUp = input.ndxReturn20d > 0;
    const btcUp = input.btcReturn20d > 0;
    cryptoAlignsWithRisk = ndxUp === btcUp;
  }

  return { gapPp, concentrationWarning, riskAppetite, score, cryptoAlignsWithRisk };
}

// ── 6단계: 섹터(사후 확인용) ──────────────────────────────────
export function scoreStep6(input: Step6Input): Step6Result {
  const sorted = [...input.sectors].sort((a, b) => b.return5d - a.return5d);
  const top3Names = new Set(sorted.slice(0, 3).map((s) => s.name));

  const qualifying = input.sectors
    .filter((s) => top3Names.has(s.name) && s.volumeRatio >= 1.3)
    .map((s) => s.name);

  const score =
    input.sectors.length > 0 ? (qualifying.length / input.sectors.length) * 10 : 0;

  return { qualifying, score };
}

// ── 7단계: 심리 필터(합산에서 제외, 포지션 크기 조절용) ─────────
export function scoreStep7(input: Step7Input): Step7Result {
  const vixOverheated = input.vix !== null && input.vix < 15;
  const fgOverheated = input.fearGreed !== null && input.fearGreed > 75;
  const bothOverheated = vixOverheated && fgOverheated;
  const oneOverheated = (vixOverheated || fgOverheated) && !bothOverheated;
  const fearZone =
    (input.vix !== null && input.vix > 25) ||
    (input.fearGreed !== null && input.fearGreed < 25);

  return {
    bothOverheated,
    oneOverheated,
    fearZone,
    positionSizeMultiplier: bothOverheated ? 0.7 : 1.0,
  };
}

// ── 8단계: 최종 결론 ──────────────────────────────────────────
// 3단계(캐리 트레이드) 가중치는 원래 2였으나, 월가 방법론 대조 조사에서 Michael Howell(CrossBorder
// Capital)이 "엔 캐리 트레이드는 내가 생각했던 만큼의 힘이 아니다"라며 상시 2순위급 취급을 명시적으로
// 부정한 근거가 나와 1.5로 낮췄다(4·5단계와 동률) — 평상시엔 유동성보다 한 단계 낮은 보조 신호로,
// 실제 청산 이벤트 같은 급발진 리스크는 1단계의 severe-news 즉시발동 규칙이 별도로 잡아준다.
export const WEIGHTS = { step2: 2.5, step3: 1.5, step4: 1.5, step5: 1.5, step6: 0.5 };
export const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0); // 7.5

export function scoreStep8(input: Step8Input): Step8Result {
  const weighted =
    input.step2.finalScore * WEIGHTS.step2 +
    input.step3.score * WEIGHTS.step3 +
    input.step4.score * WEIGHTS.step4 +
    input.step5.score * WEIGHTS.step5 +
    input.step6.score * WEIGHTS.step6;
  const macroTrendScore = weighted / TOTAL_WEIGHT;

  let finalDecision: Step8Result["finalDecision"];
  if (macroTrendScore >= 7.0) finalDecision = "매수";
  else if (macroTrendScore >= 5.0) finalDecision = "지켜보기";
  else finalDecision = "현금비중늘리기";

  // 1단계 거부권: 한 단계 다운그레이드
  const vetoApplied = input.step1.vetoTriggered;
  if (vetoApplied) {
    if (finalDecision === "매수") finalDecision = "지켜보기";
    else if (finalDecision === "지켜보기") finalDecision = "현금비중늘리기";
  }

  let positionSizePct: number | null = null;
  if (finalDecision === "매수") {
    const base = macroTrendScore >= 8.5 ? 50 : 30;
    positionSizePct = Math.round(base * input.step7.positionSizeMultiplier);
  }

  return { macroTrendScore, finalDecision, vetoApplied, positionSizePct };
}
