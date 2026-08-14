// 뉴스 헤드라인에서 이 사이트가 이미 추적 중인 종목·지수·원자재·환율을 찾는다 — LLM이 인과관계를
// 추측하게 하지 않고, 이름이 실제로 제목에 등장했는지만 결정론적으로 판정한다(이 프로젝트 전체의
// "코드가 판정, LLM은 서술만" 원칙과 동일). news-feeds.ts의 KOREA_INDICATOR_KEYWORDS와 같은
// 키워드 매칭 패턴을 재사용.
//
// 섹터 ETF(금융·기술서비스 등)는 일반 경제 기사 어디서나 나오는 흔한 단어라 오탐이 심해 제외했다
// — 재현율보다 정확도를 우선한다(틀린 배지를 다는 것이 배지가 없는 것보다 나쁘다).
export interface MatchableTicker {
  code: string; // 화면 표시용 코드
  yahooSymbol: string; // yahoo.ts의 YAHOO_TICKERS와 동일한 값(장중봉 조회용)
  keywords: string[];
}

export const MATCHABLE_TICKERS: MatchableTicker[] = [
  { code: "AAPL", yahooSymbol: "AAPL", keywords: ["애플", "Apple"] },
  { code: "MSFT", yahooSymbol: "MSFT", keywords: ["마이크로소프트", "Microsoft"] },
  { code: "GOOGL", yahooSymbol: "GOOGL", keywords: ["구글", "알파벳", "Google", "Alphabet"] },
  { code: "AMZN", yahooSymbol: "AMZN", keywords: ["아마존", "Amazon"] },
  { code: "NVDA", yahooSymbol: "NVDA", keywords: ["엔비디아", "Nvidia"] },
  { code: "META", yahooSymbol: "META", keywords: ["메타", "Meta"] },
  { code: "TSLA", yahooSymbol: "TSLA", keywords: ["테슬라", "Tesla"] },
  { code: "KOSPI", yahooSymbol: "^KS11", keywords: ["코스피"] },
  { code: "S&P500", yahooSymbol: "^GSPC", keywords: ["S&P500", "S&P 500", "스탠더드앤드푸어스"] },
  { code: "나스닥100", yahooSymbol: "^NDX", keywords: ["나스닥100", "나스닥 100"] },
  { code: "다우존스", yahooSymbol: "^DJI", keywords: ["다우존스", "다우 지수"] },
  { code: "러셀2000", yahooSymbol: "^RUT", keywords: ["러셀2000", "러셀 2000"] },
  { code: "국제 금", yahooSymbol: "GC=F", keywords: ["국제 금값", "금값", "국제 금 가격"] },
  { code: "WTI", yahooSymbol: "CL=F", keywords: ["WTI", "서부텍사스산", "국제유가"] },
  { code: "브렌트유", yahooSymbol: "BZ=F", keywords: ["브렌트유", "브렌트"] },
  { code: "달러인덱스", yahooSymbol: "DX-Y.NYB", keywords: ["달러인덱스", "달러 인덱스"] },
  { code: "원/달러", yahooSymbol: "KRW=X", keywords: ["원/달러", "원달러 환율"] },
  { code: "엔/달러", yahooSymbol: "JPY=X", keywords: ["엔/달러", "엔달러 환율", "엔화 환율"] },
  { code: "VIX", yahooSymbol: "^VIX", keywords: ["VIX", "변동성지수"] },
];

/** 제목 하나에 매칭되는 종목을 전부 찾는다(한 기사가 여러 종목과 관련될 수 있음). */
export function matchTickers(title: string): MatchableTicker[] {
  return MATCHABLE_TICKERS.filter((t) => t.keywords.some((kw) => title.includes(kw)));
}
