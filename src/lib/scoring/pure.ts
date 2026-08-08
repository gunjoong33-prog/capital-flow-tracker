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

  // 스프레드·포지션 백분위 중 하나가 데이터 부족(null)이면 예전엔 그 자리를 50(중립)으로 채워
  // 평균에 섞었다 — 실제 가용한 값이 90%ile처럼 뚜렷해도 중립값과 섞여 흐려지는 문제가 있었다
  // (2단계가 이미 쓰는 "결측은 분모에서 제외" 패턴과 불일치, 외부 감사 지적). 가용한 값만 평균한다.
  // 순포지션 백분위는 낮을수록(숏 쏠림) 캐리가 활발하다는 뜻이라 낮은 점수를 준다 — 반전 없이
  // 백분위값을 그대로 쓴다. run.ts의 met 판정(50%ile 이상일 때만 충족)과 방향이 같다.
  const knownScores = [input.spreadBpPercentile, input.cftcNetPositionPercentile].filter(
    (v): v is number => v !== null
  );
  const rawScore = knownScores.length > 0
    ? knownScores.reduce((a, b) => a + b, 0) / knownScores.length / 10
    : 5;
  // jpyVolSpike는 원래 warning 문자열에만 쓰이고 실제 score·8단계 가중합에는 전혀 반영되지 않았다
  // (외부 감사 지적, 코드 확인 결과 실제로 그랬다) — "가장 신뢰하는 실제 신호"라고 주석에 써놓고
  // 정작 점수 회로엔 연결 안 된 상태였다. 스파이크 감지 시 백분위 기반 점수를 무시하고 하드캡을 건다.
  const score = input.jpyVolSpike ? Math.min(rawScore, 2) : rawScore;

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
  const { goldDirection: gold, realRateDirection: rate, dollarDirection: dollar, us30yPercentile } = input;
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

  // "금↓ 실질금리↑" 만점(10점)은 실질금리가 왜 오르는지 구분하지 못한다 — 성장 기대로 오른 경우와
  // 장기물 금리 자체가 급등(텀프리미엄, 금융여건 긴축)해서 오른 경우를 같은 칸에 넣는다(외부 감사
  // 지적, 코드 확인 결과 실제 그랬다). 30년물이 자체 1년 분포 상단(90%ile 이상)까지 급등하면서
  // 동시에 달러가 실질금리와 다른 방향으로 가는(디커플링) 경우는 "성장 기대"보다 "텀프리미엄 급등"
  // 신호에 가깝다고 보고 점수를 절반(5)으로 낮춘다. 두 조건 모두 필요 — 30Y 백분위만으로는 원인을
  // 못 가리므로(고금리가 오래 지속되면 항상 상단에 있을 수 있다) 디커플링과 함께 볼 때만 조정한다.
  if (gold === "down" && rate === "up" && us30yPercentile !== null && us30yPercentile >= 90 && !dollarConfirms) {
    score = 5;
    note = "실질금리 상승이 성장 기대보다 장기물 금리 급등(텀프리미엄·금융여건 긴축)에 의한 것으로 보여 성장주 호재로 보기 어려움 — 점수 하향 조정";
  }

  return { quadrant, score, note, dollarConfirms };
}

// ── 5단계: 규모별·성격별 자금 도착 ────────────────────────────
export function scoreStep5(input: Step5Input): Step5Result {
  const gapPp = input.ndxReturn20d - input.rutReturn20d;
  const concentrationWarning = Math.abs(gapPp) > 3;

  let riskAppetite: Step5Result["riskAppetite"] = "중립";
  if (input.djiReturn20d > input.spxReturn20d) riskAppetite = "안전선호";
  else if (input.spxReturn20d > input.djiReturn20d) riskAppetite = "위험선호";

  // 격차가 작을수록 높은 점수(= 100 - 백분위). 단, 이 격차 백분위는 "나스닥100이 러셀2000보다
  // 상대적으로 얼마나 부진한가"만 볼 뿐 절대 방향은 모른다 — 나스닥100 -10%·러셀2000 -4%처럼 둘 다
  // 폭락한 날도 "격차가 크다"는 이유로 만점에 가까운 점수가 나와 위험선호 신호로 오독되는 문제가 있었다
  // (예: 2026-07-30 리포트에서 9.8/10). 두 지수 모두 하락 중이면 "자금이 중소형주로 확산"이 아니라
  // "대형주가 더 크게 팔렸다"는 뜻이므로 위험선호 판정 자체를 절반으로 감쇠한다.
  // 처음엔 "둘 다 음수일 때만" 감쇠했는데, 나스닥100 -10%·러셀2000 +0.5%처럼 나스닥만 급락하고
  // 러셀은 소폭이라도 플러스인 경우엔 여전히 감쇠가 안 걸려 똑같은 만점 오독이 재현됐다(외부
  // 교차검증 지적) — 문제의 본질은 "대형 기술주가 빠지고 있는가"이지 "둘 다 마이너스인가"가
  // 아니므로, 나스닥100 자체가 마이너스면 감쇠하도록 조건을 넓힌다.
  const rawScore = input.gapPercentile !== null ? (100 - input.gapPercentile) / 10 : 5;
  const ndxDeclining = input.ndxReturn20d < 0;
  const score = ndxDeclining ? rawScore * 0.5 : rawScore;

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

  // 분자(qualifying)는 top3 제한 때문에 최대 3인데, 분모를 전체 섹터 개수로 나누면 만점(10점)에
  // 구조적으로 도달할 수 없다(섹터 10개 기준 최대 3.0/10) — 외부 감사 지적, 계산 확인 결과 실제
  // 발생. 분모도 min(3, 섹터개수)로 맞춰 "top3 전부가 거래량까지 충족"할 때 10점이 나오게 한다.
  const denom = Math.min(3, input.sectors.length);
  const score = denom > 0 ? (qualifying.length / denom) * 10 : 0;

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

  // 과열 신호 2개(VIX<15 AND F&G>75) 동시 발동은 기존 0.7배 그대로 두고, 1개만 뜬 경우(oneOverheated
  // — 계산은 해뒀지만 그동안 버려지던 신호)에 0.85배 중간 단계를 추가했다. 두 앵커값(0.7, 1.0)은
  // 그대로라 기존 계산과 하위호환된다. fearZone(VIX>25 또는 F&G<25, "공포 국면")은 저가매수 기회로
  // 볼지 패닉으로 볼지 실무에서도 갈리고 이 프로젝트엔 검증할 데이터가 없어 방향을 정하지 않고
  // 사이징에서 제외했다 — 나중에 데이터가 쌓이면 재검토.
  const positionSizeMultiplier = bothOverheated ? 0.7 : oneOverheated ? 0.85 : 1.0;

  return {
    bothOverheated,
    oneOverheated,
    fearZone,
    positionSizeMultiplier,
  };
}

// ── 8단계: 최종 결론 ──────────────────────────────────────────
// 3단계(캐리 트레이드) 가중치는 원래 2였으나, 월가 방법론 대조 조사에서 Michael Howell(CrossBorder
// Capital)이 "엔 캐리 트레이드는 내가 생각했던 만큼의 힘이 아니다"라며 상시 2순위급 취급을 명시적으로
// 부정한 근거가 나와 1.5로 낮췄다(4·5단계와 동률) — 평상시엔 유동성보다 한 단계 낮은 보조 신호로,
// 실제 청산 이벤트 같은 급발진 리스크는 1단계의 severe-news 즉시발동 규칙이 별도로 잡아준다.
export const WEIGHTS = { step2: 2.5, step3: 1.5, step4: 1.5, step5: 1.5, step6: 0.5 };
export const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0); // 7.5

/**
 * macroTrendScore(가중평균, 거부권 적용 전) 하나만으로 몇 단계 임계값에 해당하는지 판정한다.
 * scoreStep8() 내부에서도 이 함수를 쓰고, UI(ReportView.tsx)에서도 "거부권이 실제로 결론을
 * 바꿨는지"(원점수 기준 결론과 최종 결론이 다른지)를 보여주려고 별도로 재사용한다 — 이미 최하단
 * (현금비중늘리기)인 날은 거부권이 발동돼도 결론이 안 바뀌는데, 예전엔 배지가 항상 "한 단계 하향
 * 조정됨"이라고만 표시해 실제로 바뀌었는지 알 수 없었다(외부 감사 지적, 실제 확인 — 관찰된 13일
 * 전부 이미 최하단이라 거부권이 결론을 바꾼 날이 하루도 없었을 가능성이 높았다).
 */
export function decisionFromScore(score: number): Step8Result["finalDecision"] {
  if (score >= 7.0) return "매수";
  if (score >= 5.0) return "지켜보기";
  return "현금비중늘리기";
}

export function scoreStep8(input: Step8Input): Step8Result {
  const weighted =
    input.step2.finalScore * WEIGHTS.step2 +
    input.step3.score * WEIGHTS.step3 +
    input.step4.score * WEIGHTS.step4 +
    input.step5.score * WEIGHTS.step5 +
    input.step6.score * WEIGHTS.step6;
  const macroTrendScore = weighted / TOTAL_WEIGHT;

  let finalDecision = decisionFromScore(macroTrendScore);

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
