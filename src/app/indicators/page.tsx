import { SiteHeader } from "@/components/SiteHeader";
import { CnnFearGreedGauge } from "@/components/CnnFearGreedGauge";
import { getLatestMetric } from "@/lib/metrics";
import { METRICS } from "@/lib/sources/types";
import { ibmPlexMono, mrsSaintDelafield } from "@/lib/site-fonts";
import siteStyles from "@/styles/site.module.css";
import styles from "./page.module.css";
import { WidgetCard } from "./WidgetCard";
import { TradingViewSection } from "./TradingViewSection";

export const dynamic = "force-dynamic"; // CNN 공포탐욕지수를 매 요청 시 DB에서 최신값으로 조회

const CNN_FEARGREED_TIP = `CNN이 매일 발표하는 시장 심리 종합지수(0~100)다.
리포트 7단계에서 매수 비중 조절에 실제로 쓰는 지표와 같다.
- 성격이 다른 7개 하위지표(주가 모멘텀·강도·폭, 풋/콜 옵션 비율, 변동성(VIX), 안전자산 수요, 정크본드 수요)를 종합한 값이다
- 0~24 극단적 공포 · 25~44 공포 · 45~55 중립 · 56~75 탐욕 · 76~100 극단적 탐욕
- 매일 오전 9시(한국시간) 파이프라인이 갱신 — 그 전에는 전날 값이 표시된다
→ 극단적 공포는 역발상 매수, 극단적 탐욕은 단기 조정 위험 신호로 참고`;

export default async function IndicatorsPage() {
  const fearGreedMetric = await getLatestMetric(METRICS.CNN_FEAR_GREED);
  const fearGreedValue = fearGreedMetric?.value ?? null;
  const fearGreedDateLabel = fearGreedMetric
    ? fearGreedMetric.date.toLocaleDateString("ko-KR", { month: "long", day: "numeric", timeZone: "UTC" })
    : null;

  return (
    <div
      className={`${siteStyles.page} ${ibmPlexMono.variable} ${mrsSaintDelafield.variable}`}
      style={{
        ["--font-gothic" as string]: "'Gothic A1', sans-serif",
        ["--font-sans" as string]: "'IBM Plex Sans KR', sans-serif",
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@500;700;800&family=IBM+Plex+Sans+KR:wght@400;600&display=swap"
      />
      <SiteHeader current="indicators" />

      <div className={siteStyles.wrap} style={{ paddingTop: "1.5rem" }}>
        <TradingViewSection>
          <WidgetCard title="CNN 공포와 탐욕 지수" bodyClass={styles.cnn__body} tip={CNN_FEARGREED_TIP}>
            <CnnFearGreedGauge value={fearGreedValue} />
          </WidgetCard>
          <p className={styles.caption}>
            {fearGreedDateLabel ? `${fearGreedDateLabel} 기준` : "확인 못함"} · 매일 오전 9시(한국시간) 갱신
          </p>
        </TradingViewSection>
      </div>
    </div>
  );
}
