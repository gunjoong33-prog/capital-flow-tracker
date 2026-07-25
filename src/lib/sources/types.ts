// 체크리스트 v2 프롬프트가 요구하는 모든 지표 식별자.
// MetricValue.metric 컬럼에 그대로 쓰인다.
export const METRICS = {
  // 2단계 해외
  WALCL: "WALCL", // 연준 대차대조표
  M2: "M2", // M2 통화량
  TOTRESNS: "TOTRESNS", // 지급준비금
  RRP: "RRP", // 역레포 잔액
  TGA: "TGA", // 재무부 계정
  REAL_RATE: "REAL_RATE", // 실질금리(10년물)
  CREDIT_SPREAD: "CREDIT_SPREAD", // 크레딧 스프레드(HY OAS)
  US10Y_2Y10Y_SPREAD: "US10Y_2Y10Y_SPREAD", // 미국 2Y-10Y 스프레드
  US_CPI: "US_CPI", // 미국 CPI(계절조정, 1단계 이벤트 서프라이즈 판정용)
  US_NFP: "US_NFP", // 미국 비농업 고용자수(1단계 이벤트 서프라이즈 판정용)
  US_PPI: "US_PPI", // 미국 생산자물가지수(최종수요 기준, 1단계 이벤트 서프라이즈 판정용)
  US_PCE: "US_PCE", // 미국 PCE 물가지수(연준이 가장 중시하는 인플레 지표, 1단계 이벤트 서프라이즈 판정용)
  FED_FUNDS_RATE: "FED_FUNDS_RATE", // 연준 기준금리 상단(FOMC 실제 결정 판정용)

  // 2단계 국내
  BOK_RATE: "BOK_RATE", // 한국은행 기준금리
  KR_CPI: "KR_CPI", // 국내 CPI
  KOSPI_FOREIGN_NET: "KOSPI_FOREIGN_NET", // 외국인 순매수(코스피)

  // 3단계
  US10Y: "US10Y",
  JP10Y: "JP10Y",
  KR10Y: "KR10Y",
  CFTC_JPY_NET: "CFTC_JPY_NET", // CFTC 엔화 순포지션(레버리지드펀드 기준)
  JPY_VOL: "JPY_VOL", // 엔화 변동성(USD/JPY 일중 변동폭 대용)

  // 4단계
  GOLD: "GOLD",
  WTI: "WTI",
  BRENT: "BRENT",
  USDKRW: "USDKRW",
  USDJPY: "USDJPY",

  // 5단계
  NDX: "NDX",
  RUT: "RUT",
  DJI: "DJI",
  SPX: "SPX",
  BTC: "BTC",
  ETH: "ETH",

  // 7단계
  VIX: "VIX",
  CNN_FEAR_GREED: "CNN_FEAR_GREED", // 수동 입력
  BTC_ETF_FLOW: "BTC_ETF_FLOW", // 수동 입력
} as const;

export type MetricId = (typeof METRICS)[keyof typeof METRICS];

// 섹터 ETF 티커 (6단계, finviz 대신 직접 계산용)
export const SECTOR_ETFS = {
  AI_TECH: "XLK", // 기술
  FINANCE: "XLF", // 금융
  HEALTHCARE: "XLV", // 헬스케어
  STAPLES: "XLP", // 필수소비재
  INDUSTRIALS: "XLI", // 제조
  ENERGY: "XLE", // 에너지+인프라
  MATERIALS: "XLB", // 원자재
  AEROSPACE_DEFENSE: "ITA", // 방산·항공우주
} as const;

export interface FetchedPoint {
  metric: string;
  date: string; // YYYY-MM-DD
  value: number;
  source: "fred" | "cftc" | "coingecko" | "eodhd" | "mof" | "ecos" | "yahoo" | "manual";
}

export interface SourceFetchResult {
  points: FetchedPoint[];
  errors: { metric: string; message: string }[];
}
