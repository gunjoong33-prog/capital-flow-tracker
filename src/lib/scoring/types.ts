// v2 체크리스트 프롬프트(노션 3a7879da)의 1~8단계 규칙을 그대로 옮긴 타입.
// 계산은 결정론적이어야 하므로(재현성), 각 단계는 순수 함수로 구현하고
// DB 조회 같은 부수효과는 run.ts에서만 다룬다.

export type Direction = "up" | "down" | "flat";

export interface Step1Input {
  newsCountLast7Days: number; // 최근 7일 내 시장 흔들 뉴스 건수
  hasBigEventNext14Days: boolean; // 14일 내 큰 이벤트(FOMC 등) 예정
}
export interface Step1Result {
  vetoTriggered: boolean; // 거부권 발동 여부
  reason: string;
}

export interface Step2Input {
  // 해외 7개 — 각 항목이 "유동성 우호 방향"이면 true
  walclIncreasing: boolean | null;
  m2GrowthRising2Months: boolean | null;
  reservesRising4Weeks: boolean | null;
  rrpDeclining: boolean | null;
  tgaDeclining: boolean | null;
  realRateFallingOrLowFlat: boolean | null;
  creditSpreadNarrowing: boolean | null;
  // 국내 3개(참고용, 보정에만 씀)
  domesticWeightHigh: boolean; // 한국 자산 비중 높은지(설정값)
  bokRateEasing: boolean | null;
  cpiNearTarget: boolean | null;
  kospiForeignNetBuying: boolean | null;
}
export interface Step2Result {
  overseasScore: number; // 0~10
  overseasQualifyingCount: number;
  overseasTotalCount: number;
  domesticAdjustment: number; // -1 | 0 | +1
  finalScore: number; // overseasScore + domesticAdjustment (0~10 클램프)
}

export interface Step3Input {
  us10y: number;
  jp10y: number;
  spreadBpPercentile: number | null; // 최근 1년 백분위(0~100)
  cftcNetPositionPercentile: number | null; // 최근 1년 백분위(0~100), 음수(숏)일수록 캐리 활발
  jpyVolSpike: boolean; // USD/JPY 변동성 급등 여부(가장 신뢰하는 실제 신호)
}
export interface Step3Result {
  spreadBp: number;
  zone: "안정" | "주의" | "위험"; // 미검증 참고용 구간(11번 참고)
  score: number; // 0~10, 스프레드·포지션 백분위 평균
  warning: string | null; // jpyVolSpike면 구간표보다 우선하는 경고
}

export interface Step4Input {
  goldDirection: Direction;
  realRateDirection: Direction;
  dollarDirection: Direction; // 보조 확인용
}
export interface Step4Result {
  quadrant: string;
  score: number; // 0, 2, 3, 5, 10 중 하나(코드 내 매핑표 참고)
  note: string;
  dollarConfirms: boolean; // 달러가 실질금리와 같은 방향이면 true(신호 강함)
}

export interface Step5Input {
  ndxReturn20d: number;
  rutReturn20d: number;
  gapPercentile: number | null; // (ndx-rut) 격차의 최근 1년 백분위
  djiReturn20d: number;
  spxReturn20d: number;
  btcReturn20d: number | null;
  ethReturn20d: number | null;
}
export interface Step5Result {
  gapPp: number; // percentage point 격차
  concentrationWarning: boolean; // 격차 3%p 초과
  riskAppetite: "안전선호" | "위험선호" | "중립"; // DJI vs SPX
  score: number; // 0~10, 격차가 작을수록 높음
  cryptoAlignsWithRisk: boolean | null;
}

export interface SectorInput {
  name: string;
  return5d: number;
  volumeRatio: number; // 20일 평균 대비 배율
}
export interface Step6Input {
  sectors: SectorInput[];
}
export interface Step6Result {
  qualifying: string[]; // 상위3위 안 + 거래량 120%+ 충족 섹터
  score: number; // 0~10
}

export interface Step7Input {
  vix: number | null;
  fearGreed: number | null; // 수동 입력
}
export interface Step7Result {
  bothOverheated: boolean;
  oneOverheated: boolean;
  fearZone: boolean;
  positionSizeMultiplier: number; // 1.0 기본, 과열시 0.7
}

export interface Step8Input {
  step2: Step2Result;
  step3: Step3Result;
  step4: Step4Result;
  step5: Step5Result;
  step6: Step6Result;
  step1: Step1Result;
  step7: Step7Result;
}
export interface Step8Result {
  macroTrendScore: number; // 0~10, 가중평균(2~6단계)
  finalDecision: "매수" | "지켜보기" | "현금비중늘리기";
  vetoApplied: boolean;
  positionSizePct: number | null; // 매수 시 배분 비율
}
