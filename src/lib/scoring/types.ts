// v2 체크리스트 프롬프트(노션 3a7879da)의 1~8단계 규칙을 그대로 옮긴 타입.
// 계산은 결정론적이어야 하므로(재현성), 각 단계는 순수 함수로 구현하고
// DB 조회 같은 부수효과는 run.ts에서만 다룬다.

export type Direction = "up" | "down" | "flat";

export interface Step1Input {
  newsCountLast7Days: number; // 최근 7일 내 시장 흔들 뉴스 건수
  hasRecentEventSurprise: boolean; // 최근 발표된 FOMC/CPI/고용지표의 실제 결과가 통계적 서프라이즈였는지
}
export interface RiskyNewsItem {
  title: string;
  url: string;
  summary: string;
  date: string;
}
export interface UpcomingEventItem {
  name: string;
  date: string;
}
export interface EventOutcomeItem {
  name: string;
  date: string;
  risky: boolean;
  detail: string;
}
export interface Step1Result {
  vetoTriggered: boolean; // 거부권 발동 여부
  reason: string;
  // run.ts가 DB 조회 후 덧붙이는 필드라 pure.ts의 scoreStep1은 채우지 않는다 — 선택 필드로 둠.
  // (기존에 저장된 DailyReport에도 이 필드가 없을 수 있어 옵셔널이 하위호환에도 맞다)
  riskyNews?: RiskyNewsItem[]; // Gemini가 리스크로 판정한 뉴스(있으면 UI에 요약+링크로 표시)
  upcomingEvents?: UpcomingEventItem[]; // 14일 내 예정된 FOMC·CPI·고용지표 등(정보용, 거부권과 무관)
  recentEventOutcomes?: EventOutcomeItem[]; // 최근 발표된 이벤트의 실제 결과 서프라이즈 판정(거부권 근거)
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

// 각 단계 판정에 실제로 쓰인 기준·수치를 UI 표로 보여주기 위한 행 단위 데이터.
// met=null은 "판정 불가/정보성 행"(자동 소스 없음 등)을 뜻한다 — false와 구분해야 함.
export interface StepDetailRow {
  label: string;
  criterion: string;
  value: string;
  met: boolean | null;
}
export type StepDetails = {
  step1: StepDetailRow[];
  step2: StepDetailRow[];
  step3: StepDetailRow[];
  step4: StepDetailRow[];
  step5: StepDetailRow[];
  step6: StepDetailRow[];
  step7: StepDetailRow[];
  step8: StepDetailRow[];
};
