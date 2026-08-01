// v2 체크리스트 프롬프트(노션 3a7879da)의 1~8단계 규칙을 그대로 옮긴 타입.
// 계산은 결정론적이어야 하므로(재현성), 각 단계는 순수 함수로 구현하고
// DB 조회 같은 부수효과는 run.ts에서만 다룬다.

export type Direction = "up" | "down" | "flat";

// 1단계 거부권 가중점수 기준. 뉴스 가중치 계산은 news-events.ts의 newsItemWeight()가 담당하지만,
// pure.ts는 DB 접근 없이 순수해야 해서(verify-scoring.ts가 DB 없이 이 파일만 테스트) 상수만 여기 둔다.
export const NEWS_RISK_SCORE_THRESHOLD = 5;

export interface Step1Input {
  newsRiskScore: number; // 최근 7일 내 리스크 뉴스의 (심각도 × 출처 가중치 × 최근성 감쇠) 합산 점수
  hasRecentEventSurprise: boolean; // 최근 발표된 FOMC/CPI/고용지표의 실제 결과가 통계적 서프라이즈였는지
  hasSevereNewsInWindow: boolean; // 최근 7일 내 단독으로도 즉시 거부권 발동 수준(severity: high)인 뉴스가 있는지
}
export interface RiskyNewsItem {
  title: string;
  url: string;
  summary: string;
  date: string;
  severity: "high" | "medium" | "low";
}
export interface UpcomingEventItem {
  name: string;
  date: string;
}
export interface EventOutcomeItem {
  name: string;
  date: string;
  risky: boolean | null; // null = 판정불가(데이터 부족) — false(서프라이즈 아님으로 확인됨)와 구분
  detail: string;
  url?: string;
}
export interface Step1Result {
  vetoTriggered: boolean; // 거부권 발동 여부
  reason: string;
  // run.ts가 DB 조회 후 덧붙이는 필드라 pure.ts의 scoreStep1은 채우지 않는다 — 선택 필드로 둠.
  // (기존에 저장된 DailyReport에도 이 필드가 없을 수 있어 옵셔널이 하위호환에도 맞다)
  riskyNews?: RiskyNewsItem[]; // LLM이 리스크로 판정한 뉴스(있으면 UI에 요약+링크로 표시)
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
}
export interface Step2Result {
  overseasScore: number; // 0~10
  overseasQualifyingCount: number;
  overseasTotalCount: number;
  finalScore: number; // overseasScore와 동일(0~10)
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
  changePct1d?: number; // 전일 대비 등락률(%) — 표시용, 집계(top3+거래량)엔 안 씀
  volumeRatio: number; // 20일 평균 대비 배율
}
export interface Step6Input {
  sectors: SectorInput[];
}
export interface Step6Result {
  qualifying: string[]; // 상위3위 안 + 거래량 130%+ 충족 섹터
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
  result?: string; // met 대신 "결과" 열에 텍스트로 보여줄 값(단순 충족/불충족이 아닌 범주형 판정에 씀, 예: 5단계 위험선호/쏠림 여부)
  url?: string; // "바로가기" 열에 링크로 보여줄 원본 출처(예: 7단계 기관·내부자 매집의 Dataroma·OpenInsider 링크)
}
export type StepDetails = {
  comprehensiveReport?: string; // 1단계 카드 위 "보고서" 버튼이 보여주는 종합 해설(경제 초심자용, 1~8단계 인과관계 서술)
  step1: StepDetailRow[];
  step2: StepDetailRow[];
  step2Aux?: StepDetailRow[]; // 집계에 안 들어가는 보조 지표(순유동성, RRP 방파제, TGA 이탈도, BBB 스프레드, 美 2Y-10Y 스프레드) — 별도 토글
  step2Summary?: string; // 2단계 지표 결과를 1~3줄로 요약한 종합판단(결정론적 생성, "상세 보기" 위에 표시)
  step3Summary?: string; // 3단계 지표 결과를 1~3줄로 요약한 종합판단
  step4Aux?: StepDetailRow[]; // 집계에 안 들어가는 보조 지표(환율 USD/KRW·USD/JPY, 유가 WTI·브렌트의 전일 대비 변동) — 별도 토글
  step4Summary?: string; // 4단계 지표 결과를 1~3줄로 요약한 종합판단
  step5Aux?: StepDetailRow[]; // 집계에 안 들어가는 원자료(4대 지수·BTC·ETH 마감가 및 전일 대비 변동) — 별도 토글, 충족열 없음
  step5BigTech?: StepDetailRow[]; // 빅테크 7(Magnificent 7) 개별 종목 마감가·전일 대비 변동 — 별도 토글(step5Aux 아래), 충족열 없음
  step5Summary?: string; // 5단계 지표 결과를 1~3줄로 요약한 종합판단
  step6Summary?: string; // 6단계 지표 결과를 1~3줄로 요약한 종합판단(어느 섹터로 자금이 몰렸는지)
  step7Institutional?: StepDetailRow[]; // 기관·내부자 매집(Dataroma·OpenInsider) — 별도 토글, 충족열 없음
  step7Summary?: string; // 7단계 지표 결과를 1~3줄로 요약한 종합판단(자금 흐름·전단계 일치 여부, VIX·공포탐욕 해석)
  step3: StepDetailRow[];
  step4: StepDetailRow[];
  step5: StepDetailRow[];
  step6: StepDetailRow[];
  step7: StepDetailRow[]; // VIX·공포탐욕지수 — 기존 표, 충족열 유지
  step8: StepDetailRow[];
};
