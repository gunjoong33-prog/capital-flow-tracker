// v2 체크리스트 프롬프트(노션 3a7879da)의 1~8단계 규칙을 그대로 옮긴 타입.
// 계산은 결정론적이어야 하므로(재현성), 각 단계는 순수 함수로 구현하고
// DB 조회 같은 부수효과는 run.ts에서만 다룬다.

export type Direction = "up" | "down" | "flat";

// 1단계 거부권 가중점수 기준. 뉴스 가중치 계산은 news-events.ts의 newsItemWeight()가 담당하지만,
// pure.ts는 DB 접근 없이 순수해야 해서(pure.test.ts가 DB 없이 이 파일만 테스트) 상수만 여기 둔다.
// 2026-08-01 5→20으로 상향. 1년치 백테스트 없이 근거 있는 숫자를 낼 수는 없지만(과거 감사에서
// 이 이유로 보류했었다), 실측 7일 표본만 봐도 조용한 날 2점, 약간 시끄러운 날 5.6~6.4점,
// 전쟁급 뉴스는 93.6~107점으로 그 사이가 완전히 비어 있어 옛 기준(5)은 "약간 시끄러운 날"조차
// 거부권을 걸었다 — 사용자가 직접 상향을 지시해 20으로 조정(보수적 선택지). 표본이 늘면 재검토.
// 뉴스 위험 강도 임계값(0~10 척도, computeNewsRiskIntensity 산출값 기준).
// 예전 상수는 "가중치 합계 20점"이었는데 분모가 없어 수집량이 4건->139건으로 늘자 점수가 그대로
// 10배 뛰어 7/31 이후 단 하루도 임계 아래로 내려오지 않았다(실측). 강도는 상위 20건만 쓰고
// 이론상 최대치로 나눈 유계 척도라 수집량과 무관하다 — 관측 21일 분포(4.46~5.40)의 85%ile.
// 표본 30건이 쌓이면 이 고정값 대신 자체 이력 백분위로 전환할 것(계획은 아래 주석 참고).
export const NEWS_RISK_INTENSITY_THRESHOLD = 5.3;
/** @deprecated 합계 기반 옛 임계값. 저장된 과거 리포트 해석용으로만 남긴다. */
export const NEWS_RISK_SCORE_THRESHOLD = 20;

// 7단계 VIX·공포탐욕지수 과열/공포 임계값. pure.ts(채점)와 run.ts(화면 표시 문구·표)가 같은
// 기준선을 각자 숫자로 따로 박아뒀던 걸(외부 감사 지적과 별개로 자체 점검 중 발견) 하나로 합쳤다 —
// 둘 중 하나만 고치고 다른 쪽을 안 고치면 화면에 보이는 구간 설명과 실제 채점이 어긋난다.
export const VIX_OVERHEAT_BELOW = 15; // 이 미만이면 과열(저변동성 방심 구간)
export const VIX_FEAR_ABOVE = 25; // 이 초과면 공포 구간
export const FEAR_GREED_EXTREME_FEAR_BELOW = 25;
export const FEAR_GREED_EXTREME_GREED_ABOVE = 75;

export interface Step1Input {
  newsRiskScore: number; // 최근 7일 내 리스크 뉴스의 (심각도 × 출처 가중치 × 최근성 감쇠) 합산 점수 — 참고 기록용
  /** 0~10 유계 강도(상위 20건만 사용, 이론상 최대치로 정규화). 거부권 점수 경로는 이 값을 본다.
   *  선택 필드인 이유: 저장된 과거 리포트에는 없다(그 시절엔 합계뿐) — 없으면 0으로 취급한다. */
  newsRiskIntensity?: number;
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
  newsRiskIntensity?: number; // 0~10 유계 강도(거부권 점수 경로의 실제 입력)
  newsRiskItemsUsed?: number; // 강도 계산에 실제로 쓴 항목 수(상한 20)
  newsRiskItemsTotal?: number; // 그날 창 안의 리스크 뉴스 총 건수(수집량 추이 확인용)
  newsRiskScore?: number; // 최근 7일 리스크 뉴스 가중점수 원값(파이프라인이 MetricValue로 저장해
  // 시계열을 쌓는다 — 표본이 쌓이면 절대 임계값(NEWS_RISK_SCORE_THRESHOLD) 대신 백분위 기반
  // 거부권으로 전환 가능해진다. calculatePercentile은 30개 미만 표본이면 null을 반환하므로
  // 그 전까지는 절대 임계값이 그대로 기준이다)
}

export interface Step2Input {
  // 각 항목은 0~1 "충족 강도"다. 예전엔 boolean이었는데, "최근 N기간 연속 증가"를 전부 만족해야만
  // 1점이고 한 기간이라도 어긋나면 0점이라 눈금이 지나치게 거칠었다 — 실측 21일 동안 2단계 점수가
  // 3.33 아니면 5.00 두 값밖에 안 나왔고(가중치 33%짜리 최대 항목), 그 탓에 총점이 구조적으로
  // 상단에 못 닿았다. 이제 "N기간 중 몇 기간이 방향에 맞았는가"의 비율을 쓴다.
  // 1 = 전 기간 충족(옛 true), 0 = 전 기간 어긋남(옛 false), null = 데이터 부족(분모에서 제외).
  walclIncreasing: number | null;
  m2GrowthRising2Months: number | null;
  reservesRising4Weeks: number | null;
  rrpDeclining: number | null;
  tgaDeclining: number | null;
  realRateFallingOrLowFlat: number | null;
  creditSpreadNarrowing: number | null;
}
export interface Step2Result {
  overseasScore: number;
  overseasQualifyingCount: number; // 완전 충족(강도 1) 항목 수 — 화면의 ✓ 개수와 일치
  overseasTotalCount: number; // 판정 가능한 항목 수(결측 제외)
  overseasStrengthSum: number; // 강도 합계(부분 충족 포함) — 점수의 실제 분자
  finalScore: number;
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
  us30yPercentile: number | null; // 美 30년물 국채금리의 최근 1년 백분위(텀프리미엄 급등 판별용)
  // 아래 두 값은 사분면 "안에서의 위치"를 정하는 크기다. 없으면(과거 리포트 재계산 등) 방향
  // enum만으로 꼭짓점 점수를 그대로 쓴다 — 옛 동작과 동일해 하위호환이 깨지지 않는다.
  goldChangePct?: number | null; // 금값 직전 대비 변화율(%)
  realRateChangeBp?: number | null; // 실질금리 직전 대비 변화(bp)
}
export interface Step4Result {
  quadrant: string;
  score: number; // 0~10 연속값(사분면 꼭짓점 2·5·10·3 사이를 이중선형 보간)
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
  coinMomentumHigherThanStock: boolean | null; // (BTC+ETH)/2 20일 수익률이 (NDX+RUT)/2보다 높은지 — 자산배분 가이드의 코인 비중 결정에 씀. 코인 데이터 없으면 null.
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
  cashAllocationPct: number | null; // 현금비중늘리기 시 권장 현금 비중(참고용, 투자자문 아님)
  assetAllocation: AssetAllocation; // 위 이분법을 5개 자산군으로 세분화한 참고용 가이드(고정 규칙 기반, 투자자문 아님)
}

// 자산배분 가이드 — 전부 고정 규칙(코드에 노출된 상수)으로 계산되는 참고용 수치다. LLM이 이 비율
// 자체를 만들지 않는다(narrative.ts가 이 숫자를 받아 "왜 이런지"만 서술). 부동산은 이 사이트에
// 실제 신호가 없어 항상 0 — "분석 결과 0%"가 아니라 "다룰 데이터가 없다"는 뜻.
export interface AssetAllocation {
  stock: number;
  coin: number;
  bond: number;
  realEstate: number;
  cash: number;
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
  comprehensiveReportNoContext?: string; // 위와 같은 프롬프트로 자가학습 요약만 뺀 대조군(self-learning 페이지의 반영도 A/B 비교용, 실제 서비스 화면엔 안 씀)
  step1: StepDetailRow[];
  step2: StepDetailRow[];
  step2Aux?: StepDetailRow[]; // 집계에 안 들어가는 보조 지표(순유동성, RRP 방파제, TGA 이탈도, BBB 스프레드, 美 2Y-10Y 스프레드) — 별도 토글
  step2Summary?: string; // 2단계 지표 결과를 1~3줄로 요약한 종합판단(결정론적 생성, "상세 보기" 위에 표시)
  step3Summary?: string; // 3단계 지표 결과를 1~3줄로 요약한 종합판단
  step4Aux?: StepDetailRow[]; // 집계에 안 들어가는 보조 지표(환율 USD/KRW·USD/JPY, 외국인 코스피 순매수, 유가 WTI·브렌트의 전일 대비 변동) — 별도 토글
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
  // 종합 보고서 "앞으로 자본이 이동할 곳" 문단 전용 재료 — 예측을 만들어내는 게 아니라 "무엇이
  // 바뀌면 무엇이 따라 바뀌는가"의 조건문 재료만 제공한다(LLM이 여기 없는 미래를 지어내지 못하게
  // 막는 게 목적). 전부 이미 계산된 값의 재조합이라 별도 API 호출 없음.
  forwardSignals?: {
    liquidityCycle: {
      netLiquidityDirection: "상승" | "하락" | "확인 못함";
      rrpBuffer: string;
      creditSpreadBp: number | null;
      creditLeadsEquity: string;
    };
    upcomingEvents: string | null;
    quadrantExit: { current: string; ifGoldFlips: string; ifRateFlips: string };
    // LLM이 사분면 점수를 임의로 지어내지 못하게 기본 점수표(텀프리미엄 조정 전)를 그대로 실어 보낸다.
    quadrantScoreTable: Record<string, number>;
    // 예전엔 raw bp/pt 숫자만 줬는데, LLM이 "목표까지 남은 거리"를 스스로 계산하다 틀리는 사례가
    // 있었다 — 문장으로 미리 완성해 옮겨적기만 하면 되게 한다.
    distanceToThresholds: {
      carrySafeMargin: string;
      vixFearMargin: string;
      creditNormalMargin: string;
      scoreToWatchMargin: string;
    };
    institutionalDirection: string | null;
  };
  pptSlides?: PptSlide[];
};

// 홈 화면 PPT 슬라이드 카드(9장: 1~8단계 + 종합 결론). 숫자·사실은 ppt-slides.ts가 결정론적으로
// 채우고, headline만 ppt-headlines.ts가 LLM으로 채운다(초기값은 kicker와 동일 — 실패 시 폴백 겸함).
export interface PptSlide {
  step: number; // 1~8, 9(종합 결론)
  kicker: string;
  headline: string;
  body: string;
  visual: PptSlideVisual;
}

export type PptSlideVisual =
  | { type: "stat-pair"; left: PptStat; right: PptStat }
  | { type: "bar-pair"; left: PptBar; right: PptBar }
  | { type: "ratio-bar"; qualifying: number; total: number; label: string }
  | { type: "weight-bars"; rows: { label: string; score: number; weight: number }[] }
  | { type: "none" };

export interface PptStat {
  value: string;
  label: string;
  tone?: "pos" | "neg" | "accent";
}

export interface PptBar {
  value: string;
  label: string;
  heightPct: number; // 0~100
}
