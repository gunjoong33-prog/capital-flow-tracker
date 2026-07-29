import type { ReactNode } from "react";
import { SiteNav } from "@/components/SiteNav";
import { TradingViewWidget } from "@/components/TradingViewWidget";

// 노션 대시보드 페이지의 트레이딩뷰 위젯 구성(티커테이프 + 히트맵 + 환율 + 기술적분석)을
// 그대로 옮긴 홈 화면 — 사이트 디자인 테마(zinc 다크)에 맞춰 껍데기만 새로 입혔다.
const TICKER_TAPE_CONFIG = {
  symbols: [
    { proName: "FOREXCOM:SPXUSD", title: "S&P500" },
    { proName: "FOREXCOM:NSXUSD", title: "나스닥100" },
    { proName: "AMEX:DIA", title: "다우존스" },
    { proName: "FX_IDC:USDKRW", title: "USD/KRW" },
    { proName: "FX:USDJPY", title: "USD/JPY" },
    { proName: "TVC:GOLD", title: "금" },
    { proName: "TVC:USOIL", title: "WTI" },
    { proName: "BITSTAMP:BTCUSD", title: "BTC" },
  ],
  colorTheme: "dark",
  locale: "kr",
  largeChartUrl: "",
  isTransparent: true,
  showSymbolLogo: true,
  displayMode: "adaptive",
};

const HEATMAP_CONFIG = {
  exchanges: [],
  dataSource: "SPX500",
  grouping: "sector",
  blockSize: "market_cap_basic",
  blockColor: "change",
  locale: "kr",
  symbolUrl: "",
  colorTheme: "dark",
  hasTopBar: true,
  isDataSetEnabled: true,
  isZoomEnabled: true,
  hasSymbolTooltip: true,
  isMonoSize: false,
  width: "100%",
  height: "100%",
};

const FX_CONFIG = {
  symbol: "FX_IDC:USDKRW",
  width: "100%",
  height: "100%",
  locale: "kr",
  dateRange: "1M",
  colorTheme: "dark",
  isTransparent: true,
  autosize: true,
  largeChartUrl: "",
};

// 노션 원본은 이 위젯을 "탐욕과 공포" 토글 아래 두었다 — CNN 공포탐욕지수(7단계에서 별도 스크래핑)와
// 달리 여기선 트레이딩뷰 기술적분석 게이지(SPX, Strong Sell~Strong Buy)를 그대로 쓴다(기능 동일 이식).
const SENTIMENT_CONFIG = {
  interval: "1D",
  width: "100%",
  isTransparent: true,
  height: "100%",
  symbol: "AMEX:SPY",
  showIntervalTabs: true,
  displayMode: "single",
  locale: "kr",
  colorTheme: "dark",
};

/** "→ 요약문장" 줄만 굵게 강조해서 나머지 설명과 시각적으로 구분한다(가독성 최적화). */
function TipText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) =>
        line.startsWith("→") ? (
          <p key={i} className="[word-break:keep-all] pt-1 font-medium text-zinc-200">
            {line}
          </p>
        ) : (
          <p key={i} className="[word-break:keep-all]">
            {line}
          </p>
        )
      )}
    </div>
  );
}

function WidgetCard({
  title,
  height,
  tip,
  children,
}: {
  title: string;
  height: string;
  tip?: string;
  children: ReactNode;
}) {
  const tipId = tip ? `home-tip-${title}` : undefined;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      {tip && <input type="checkbox" id={tipId} className="peer hidden" />}
      <div className="mb-2 flex items-center gap-1.5">
        <p className="text-xs text-zinc-500">{title}</p>
        {tip && (
          <label
            htmlFor={tipId}
            className="flex h-4 w-4 cursor-pointer select-none items-center justify-center rounded-full border border-zinc-700 text-[10px] leading-none text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
          >
            ?
          </label>
        )}
      </div>
      {tip && (
        <div className="peer-checked:block mb-2 hidden rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs leading-relaxed text-zinc-400">
          <TipText text={tip} />
        </div>
      )}
      <div className={height}>{children}</div>
    </div>
  );
}

const HEATMAP_TIP = `S&P500 편입 종목을 섹터별 사각형으로 표시한 지도.
- 사각형 크기 = 기본값은 시가총액 — 상단 "사이즈" 메뉴에서 거래량 등으로 바꿀 수 있다
- 색상 = 등락률(초록 상승 · 빨강 하락) — 진할수록 변동폭이 크다는 뜻
- 상단 "그룹 기준"에서 섹터별 · 개별 종목 등 묶는 기준을 바꿀 수 있다
- 상단 "자료"에서 S&P500 외 다른 지수·업종으로 바꿔볼 수 있다
이 차트를 보면 오늘 시장이 전반적으로 오르고 있는지, 어떤 업종이 강한지, 약한지를 한눈에 알 수 있다.
→ 오늘 미국 시장의 분위기와 자금이 몰리는 방향을 볼 때 확인`;

const FX_TIP = `원·달러(USD/KRW) 환율 미니 차트.
- 값이 오르면 달러 강세 · 원화 약세, 내리면 반대
- 하단 기간 탭(1M 등)에서 조회 기간을 바꿀 수 있다
- 해외 투자·환헤지 비용을 가늠할 때 참고하는 기초 지표다`;

const SENTIMENT_TIP = `SPY(S&P500 ETF) 가격의 최근 흐름을 여러 보조지표로 계산해 매수·매도 신호를 게이지로 보여주는 트레이딩뷰 기술적 분석 요약.
- 이동평균선·오실레이터 등 지표 각각을 매도(셀) · 중립(뉴트럴) · 매수(바이)로 판정해 합산한다
- 바늘이 오른쪽(바이)에 가까울수록 매수 신호 우세, 왼쪽(셀)에 가까울수록 매도 신호 우세
- 하단 숫자는 셀/뉴트럴/바이로 판정된 지표 개수(예: 셀 10 · 뉴트럴 9 · 바이 7)
- 상단 탭(1분·5분·1일 등)에서 기준 기간을 바꿀 수 있다
→ 시장의 단기 과열·과매도 여부를 참고할 때 확인`;

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto max-w-6xl space-y-4">
        <SiteNav active="landing" />

        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
          <TradingViewWidget
            src="https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js"
            config={TICKER_TAPE_CONFIG}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[68fr_32fr]">
          <WidgetCard title="히트맵 — S&P 500" height="h-[560px] lg:h-[300px]" tip={HEATMAP_TIP}>
            <TradingViewWidget
              src="https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js"
              config={HEATMAP_CONFIG}
            />
          </WidgetCard>

          <div className="space-y-4">
            <WidgetCard title="환율 — 원·달러(USD/KRW)" height="h-[200px]" tip={FX_TIP}>
              <TradingViewWidget
                src="https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js"
                config={FX_CONFIG}
              />
            </WidgetCard>
            <WidgetCard title="탐욕과 공포 — S&P500 기술적 분석" height="relative h-[280px] overflow-hidden" tip={SENTIMENT_TIP}>
              {/* 위젯 자체 헤더("SPY 에 대한 테크니컬 어낼리시스")가 카드 제목과 중복되고 번역도
                  어색해서 위로 크롭해 숨기고, 하단은 "셀/뉴트럴/바이" 개수 줄 바로 아래에서 잘라
                  로고 여백을 없앤다 — 위젯이 cross-origin iframe이라 내부 텍스트 자체는 못 바꾼다. */}
              <div className="absolute inset-x-0 h-[450px]" style={{ top: "-78px" }}>
                <TradingViewWidget
                  src="https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js"
                  config={SENTIMENT_CONFIG}
                />
              </div>
            </WidgetCard>
          </div>
        </div>
      </main>
    </div>
  );
}
