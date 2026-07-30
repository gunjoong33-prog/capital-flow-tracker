import type { ReactNode } from "react";
import { SiteNav } from "@/components/SiteNav";
import { TradingViewWidget } from "@/components/TradingViewWidget";
import { CnnFearGreedGauge } from "@/components/CnnFearGreedGauge";
import { getLatestMetric } from "@/lib/metrics";
import { METRICS } from "@/lib/sources/types";

export const dynamic = "force-dynamic"; // CNN 공포탐욕지수를 매 요청 시 DB에서 최신값으로 조회

// 노션 대시보드 페이지의 트레이딩뷰 위젯 구성(티커테이프 + 히트맵 + 환율 + 기술적분석)을
// 그대로 옮긴 홈 화면 — 사이트 디자인 테마(zinc 다크)에 맞춰 껍데기만 새로 입혔다.
const TICKER_TAPE_CONFIG = {
  symbols: [
    { proName: "FOREXCOM:SPXUSD", title: "S&P500" },
    { proName: "AMEX:IWM", title: "러셀2000" },
    { proName: "FOREXCOM:NSXUSD", title: "나스닥100" },
    { proName: "AMEX:DIA", title: "다우존스" },
    { proName: "FX_IDC:USDKRW", title: "USD/KRW" },
    { proName: "FX:USDJPY", title: "USD/JPY" },
    { proName: "TVC:GOLD", title: "금" },
    { proName: "TVC:USOIL", title: "WTI" },
    { proName: "TVC:UKOIL", title: "브렌트유" },
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

const CNN_FEARGREED_TIP = `CNN이 매일 발표하는 시장 심리 종합지수(0~100). 리포트 7단계에서 매수 비중 조절에 실제로 쓰는 지표와 같다.
- 성격이 다른 7개 하위지표(주가 모멘텀·강도·폭, 풋/콜 옵션 비율, 변동성(VIX), 안전자산 수요, 정크본드 수요)를 종합한 값이다
- 0~24 극단적 공포 · 25~44 공포 · 45~55 중립 · 56~75 탐욕 · 76~100 극단적 탐욕
- SPY 한 종목의 기술적 지표가 아니라 시장 전체의 투자자 심리(공포·탐욕)를 재는 지수다
- 매일 오전 9시(한국시간) 파이프라인이 갱신 — 그 전에는 전날 값이 표시된다
→ 극단적 공포는 역발상 매수, 극단적 탐욕은 단기 조정 위험 신호로 참고`;

export default async function LandingPage() {
  const fearGreedMetric = await getLatestMetric(METRICS.CNN_FEAR_GREED);
  const fearGreedValue = fearGreedMetric?.value ?? null;
  const fearGreedDateLabel = fearGreedMetric
    ? fearGreedMetric.date.toLocaleDateString("ko-KR", { month: "long", day: "numeric", timeZone: "UTC" })
    : null;

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto max-w-6xl space-y-4">
        <SiteNav active="landing" />

        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
          {/* 심볼 10개 기준 트레이딩뷰 티커테이프의 adaptive 모드는 컨테이너가 ~1200px보다 좁으면
              가격·변동액·변동률 텍스트를 모두 버리고 +/- 기호만 남기므로, 모바일 폭에서도 항상
              전체 텍스트로 렌더링되도록 내부 폭을 고정하고 바깥 박스에서만 화면 폭에 맞게 잘라낸다. */}
          <div className="min-w-[1200px]">
            <TradingViewWidget
              src="https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js"
              config={TICKER_TAPE_CONFIG}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[68fr_32fr]">
          <WidgetCard title="히트맵 — S&P 500" height="h-[560px]" tip={HEATMAP_TIP}>
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
            <WidgetCard title="CNN 공포와 탐욕 지수" height="h-[210px]" tip={CNN_FEARGREED_TIP}>
              <CnnFearGreedGauge value={fearGreedValue} />
            </WidgetCard>
            <p className="-mt-2 text-center text-[11px] text-zinc-600">
              {fearGreedDateLabel ? `${fearGreedDateLabel} 기준` : "확인 못함"} · 매일 오전 9시(한국시간) 갱신
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
