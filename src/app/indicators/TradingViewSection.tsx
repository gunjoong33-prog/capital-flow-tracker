"use client";

import type { ReactNode } from "react";
import { TradingViewWidget } from "@/components/TradingViewWidget";
import { WidgetCard } from "./WidgetCard";
import { useSiteTheme } from "@/lib/useSiteTheme";
import styles from "./page.module.css";

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

/** 티커테이프·히트맵·환율 미니차트 — TradingView 위젯은 colorTheme을 스크립트 config로만
 * 받기 때문에(CSS 변수로 못 바꿈) 이 부분만 클라이언트 컴포넌트로 분리해 useSiteTheme으로
 * 현재 다크/라이트 상태를 읽고 config에 실시간으로 반영한다.
 *
 * CNN 공포탐욕지수 카드는 서버에서 실제 DB 값으로 렌더돼야 해서 이 컴포넌트 안에서 직접
 * 만들지 않는다 — page.tsx가 서버에서 렌더한 카드를 children으로 그대로 넘겨받아
 * sideStack(환율 카드 바로 아래) 안에 끼워 넣는다(Server Component를 Client Component의
 * children으로 넘기는 표준 패턴). */
export function TradingViewSection({ children }: { children: ReactNode }) {
  const theme = useSiteTheme();

  const tickerTapeConfig = {
    // 러셀2000·다우존스는 원래 실제 상장 ETF(AMEX:IWM, AMEX:DIA)를 썼는데, 이 두 심볼만
    // 지연시세라 트레이딩뷰가 가격 뒤에 "• 지연" 배지를 따로 붙인다 — 나머지 8개 심볼엔 없는
    // 배지라 항목마다 너비가 들쭉날쭉해지고 그게 "배너 전체 글씨 간격이 안 맞다"는 지적의
    // 실제 원인이었다(실사용 확인). S&P500·나스닥100처럼 FOREXCOM 실시간 프록시로 바꾸면
    // (러셀2000은 FOREXCOM에 없어서 OANDA로 대체) 배지 없이 전부 같은 포맷으로 렌더링된다.
    symbols: [
      { proName: "FOREXCOM:SPXUSD", title: "S&P500" },
      { proName: "OANDA:US2000USD", title: "러셀2000" },
      { proName: "FOREXCOM:NSXUSD", title: "나스닥100" },
      { proName: "FOREXCOM:DJI", title: "다우존스" },
      { proName: "FX_IDC:USDKRW", title: "USD/KRW" },
      { proName: "FX:USDJPY", title: "USD/JPY" },
      { proName: "TVC:GOLD", title: "금" },
      { proName: "TVC:USOIL", title: "WTI" },
      { proName: "TVC:UKOIL", title: "브렌트유" },
      { proName: "BITSTAMP:BTCUSD", title: "BTC" },
    ],
    colorTheme: theme,
    locale: "kr",
    largeChartUrl: "",
    isTransparent: true,
    // 심볼 로고 배지는 심볼마다 크기가 다르다(예: OANDA:US2000USD는 전용 로고가 없어서
    // "2000"이라는 4자리 숫자를 넣은 배지로 대체되는데, 이게 다른 심볼의 작은 원형 로고보다
    // 훨씬 커서 그 항목만 줄 높이가 튀어 보였다 — "세 줄 높낮이가 들쭉날쭉하다"는 지적의
    // 실제 원인, 실사용 확인). 로고를 아예 껐다: 배지 크기 편차가 원천적으로 없어지고,
    // 텍스트만 남아 폭도 줄어서 320px에서도 3줄로 안 쌓이고 한 줄을 유지한다.
    showSymbolLogo: false,
    displayMode: "regular",
  };

  const heatmapConfig = {
    exchanges: [],
    dataSource: "SPX500",
    grouping: "sector",
    blockSize: "market_cap_basic",
    blockColor: "change",
    locale: "kr",
    symbolUrl: "",
    colorTheme: theme,
    hasTopBar: true,
    isDataSetEnabled: true,
    isZoomEnabled: true,
    hasSymbolTooltip: true,
    isMonoSize: false,
    width: "100%",
    height: "100%",
  };

  const fxConfig = {
    symbol: "FX_IDC:USDKRW",
    width: "100%",
    height: "100%",
    locale: "kr",
    dateRange: "1M",
    colorTheme: theme,
    isTransparent: true,
    autosize: true,
    largeChartUrl: "",
  };

  return (
    <>
      <div className={styles.tickerWrap}>
        <TradingViewWidget
          src="https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js"
          config={tickerTapeConfig}
        />
      </div>

      <div className={styles.grid}>
        <WidgetCard title="히트맵 — S&P 500" bodyClass={styles.heatmap__body} tip={HEATMAP_TIP}>
          <TradingViewWidget
            src="https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js"
            config={heatmapConfig}
          />
        </WidgetCard>

        <div className={styles.sideStack}>
          <WidgetCard title="환율 — 원·달러(USD/KRW)" bodyClass={styles.fx__body} tip={FX_TIP}>
            <TradingViewWidget
              src="https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js"
              config={fxConfig}
            />
          </WidgetCard>
          {children}
        </div>
      </div>
    </>
  );
}
