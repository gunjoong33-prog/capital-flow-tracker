// 체크리스트 v2 프롬프트가 요구하는 모든 지표 식별자.
// MetricValue.metric 컬럼에 그대로 쓰인다.
export const METRICS = {
  // 2단계 해외
  WALCL: "WALCL", // 연준 대차대조표
  M2: "M2", // M2 통화량
  TOTRESNS: "TOTRESNS", // 기준잔액 — FRED WRESBAL(주간) 시리즈로 채움, "4주 연속" 기준에 맞춤
  RRP: "RRP", // 역레포 잔액
  TGA: "TGA", // 재무부 계정
  REAL_RATE: "REAL_RATE", // 실질금리(10년물)
  CREDIT_SPREAD: "CREDIT_SPREAD", // 크레딧 스프레드(하이일드 OAS, BAMLH0A0HYM2)
  CREDIT_SPREAD_BBB: "CREDIT_SPREAD_BBB", // BBB 등급 스프레드(보조 지표, BAMLC0A4CBBB) — 200bp 초과 시 우량기업 차환 경고
  US10Y_2Y10Y_SPREAD: "US10Y_2Y10Y_SPREAD", // 미국 2Y-10Y 스프레드
  US30Y: "US30Y", // 미국 30년물 국채금리(FRED DGS30) — 베어 스티프닝(장기금리 급등) 감지용
  US2Y: "US2Y", // 미국 2년물 국채금리(FRED DGS2) — 기준금리와의 스프레드로 시장의 향후 정책금리 기대 추정
  US_CPI: "US_CPI", // 미국 CPI(계절조정, 1단계 이벤트 서프라이즈 판정용)
  US_NFP: "US_NFP", // 미국 비농업 고용자수(1단계 이벤트 서프라이즈 판정용)
  US_PPI: "US_PPI", // 미국 생산자물가지수(최종수요 기준, 1단계 이벤트 서프라이즈 판정용)
  US_PCE: "US_PCE", // 미국 PCE 물가지수(헤드라인) — 서프라이즈 판정용, 화면엔 안 씀(근원 PCE로 대체)
  US_PCE_CORE: "US_PCE_CORE", // 근원(Core) PCE — 식품·에너지 제외, 연준이 실제 목표(YoY 2%)로 삼는 지표. FRED PCEPILFE.
  FED_FUNDS_RATE: "FED_FUNDS_RATE", // 연준 기준금리 상단(FOMC 실제 결정 판정용)

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
  DXY: "DXY", // 달러 인덱스(ICE US Dollar Index, Yahoo DX-Y.NYB) — 4단계 달러 방향 판정 기준.
  // USD/KRW는 한국 고유 수급(반도체 수출, 배당 송금, 연기금 헤지) 영향이 커서 글로벌 달러 강약의
  // 대리변수로 부적합 — 원화는 "한국 투자자 관점 보조 지표"로만 남기고 판정 기준은 DXY로 바꾼다.
  FOREIGN_NET_BUY_KOSPI: "FOREIGN_NET_BUY_KOSPI", // 외국인 코스피 순매수 대금(백만원) — 한국투자증권 Open API, USD/KRW 변동의 원인 참고용

  // 5단계
  NDX: "NDX",
  RUT: "RUT",
  DJI: "DJI",
  SPX: "SPX",
  BTC: "BTC",
  ETH: "ETH",
  KOSPI: "KOSPI", // 코스피 지수(Yahoo ^KS11) — 한국 투자자 관점 보조 지표

  // 5단계 — 빅테크 7(Magnificent 7), 나스닥100 쏠림을 실제로 이끄는 개별 종목 드릴다운
  AAPL: "AAPL",
  MSFT: "MSFT",
  GOOGL: "GOOGL",
  AMZN: "AMZN",
  NVDA: "NVDA",
  META: "META",
  TSLA: "TSLA",

  // 7단계
  VIX: "VIX",
  CNN_FEAR_GREED: "CNN_FEAR_GREED", // CNN 비공식 데이터 엔드포인트(cnn-feargreed.ts)로 자동 수집
  BTC_ETF_FLOW: "BTC_ETF_FLOW", // 수동 입력
} as const;

export type MetricId = (typeof METRICS)[keyof typeof METRICS];

// 빅테크 7(Magnificent 7) — 5단계 개별 종목 드릴다운 + 등락 원인 판정(news-feeds.ts, bigtech-reasons.ts)에서 공용으로 쓴다.
export const BIG_TECH_TICKERS = [
  METRICS.AAPL, METRICS.MSFT, METRICS.GOOGL, METRICS.AMZN, METRICS.NVDA, METRICS.META, METRICS.TSLA,
] as const;

export const BIG_TECH_LABELS: Record<string, string> = {
  [METRICS.AAPL]: "애플",
  [METRICS.MSFT]: "마이크로소프트",
  [METRICS.GOOGL]: "알파벳",
  [METRICS.AMZN]: "아마존",
  [METRICS.NVDA]: "엔비디아",
  [METRICS.META]: "메타",
  [METRICS.TSLA]: "테슬라",
};

// 섹터 ETF 티커 (6단계, finviz 대신 직접 계산용).
// 방산·항공우주는 종목 구성이 겹치지만(보잉·록히드마틴 등) 서로 다른 실제 ETF로 구분한다 —
// SHLD(Global X Defense Tech, 순수 방위산업 비중↑) vs ITA(iShares Aerospace & Defense, 항공기 제조 비중↑).
export const SECTOR_ETFS = {
  AI: "AIQ", // AI — Global X Artificial Intelligence & Technology ETF
  FINANCE: "XLF", // 금융
  TECH_SERVICES: "XLK", // 기술서비스
  HEALTHCARE: "XLV", // 헬스케어
  STAPLES: "XLP", // 필수소비재
  INDUSTRIALS: "XLI", // 제조
  ENERGY: "XLE", // 에너지+인프라
  DEFENSE: "SHLD", // 방산
  AEROSPACE: "ITA", // 항공우주
  MATERIALS: "XLB", // 원자재
} as const;

// 티커만 봐서는 무슨 섹터인지 알기 어려워 UI에 함께 표시할 한글 라벨.
export const SECTOR_LABELS: Record<keyof typeof SECTOR_ETFS, string> = {
  AI: "AI",
  FINANCE: "금융",
  TECH_SERVICES: "기술서비스",
  HEALTHCARE: "헬스케어",
  STAPLES: "필수소비재",
  INDUSTRIALS: "제조",
  ENERGY: "에너지(+인프라)",
  DEFENSE: "방산",
  AEROSPACE: "항공우주",
  MATERIALS: "원자재",
};

export interface FetchedPoint {
  metric: string;
  date: string; // YYYY-MM-DD
  value: number;
  source: "fred" | "cftc" | "coingecko" | "eodhd" | "mof" | "ecos" | "yahoo" | "cnn" | "kis" | "manual";
}

export interface SourceFetchResult {
  points: FetchedPoint[];
  errors: { metric: string; message: string }[];
}
