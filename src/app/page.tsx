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

function WidgetCard({ title, height, children }: { title: string; height: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <p className="mb-2 text-xs text-zinc-500">{title}</p>
      <div className={height}>{children}</div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto max-w-5xl space-y-4">
        <SiteNav active="landing" />

        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
          <TradingViewWidget
            src="https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js"
            config={TICKER_TAPE_CONFIG}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[62.5fr_37.5fr]">
          <WidgetCard title="히트맵 — S&P 500" height="h-[540px]">
            <TradingViewWidget
              src="https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js"
              config={HEATMAP_CONFIG}
            />
          </WidgetCard>

          <div className="space-y-4">
            <WidgetCard title="환율 — 원·달러(USD/KRW)" height="h-[230px]">
              <TradingViewWidget
                src="https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js"
                config={FX_CONFIG}
              />
            </WidgetCard>
            <WidgetCard title="탐욕과 공포 — S&P500 기술적 분석" height="h-[230px]">
              <TradingViewWidget
                src="https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js"
                config={SENTIMENT_CONFIG}
              />
            </WidgetCard>
          </div>
        </div>
      </main>
    </div>
  );
}
