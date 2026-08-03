import Link from "next/link";
import { getLatestMetric, getMetricHistory, getMetricHistoryByCount } from "@/lib/metrics";
import { getNewsPageCategory } from "@/lib/news-page";
import { METRICS } from "@/lib/sources/types";
import { HomeThemeToggle } from "@/components/HomeThemeToggle";
import { ibmPlexMono, mrsSaintDelafield } from "@/app/home-fonts";
import styles from "@/app/page.module.css";

export const dynamic = "force-dynamic"; // 환율·공포탐욕지수·뉴스를 매 요청 시 최신값으로 조회

const NAV_ITEMS = [
  { href: "/indicators", label: "지표", current: false },
  { href: "/news", label: "뉴스", current: false },
  { href: "/report", label: "오늘의 리포트", current: false },
  { href: "/calendar", label: "캘린더", current: false },
  { href: "/reports/weekly", label: "주기별 리포트", current: false },
];

const STEPS = [
  { title: "글로벌 환경", desc: "뉴스·정책 리스크가 자본을 안전자산으로 몰아낼 만큼 큰지 판정합니다. 기준을 넘으면 거부권이 발동합니다." },
  { title: "자본의 유동성", desc: "Fed 대차대조표·M2·RRP·TGA 등 7개 지표로 시중에 풀린 돈의 양과 방향을 확인합니다." },
  { title: "캐리 트레이드", desc: "美·日 10년물 금리차와 CFTC 엔화 포지션을 대조해 캐리 자금의 유입과 청산을 포착합니다." },
  { title: "환율·금·유가", desc: "금과 실질금리 조합으로 안전자산과 위험자산 사이의 이동을 판별합니다." },
  { title: "자금 도착", desc: "나스닥100·러셀2000·비트코인의 동조 여부로 자금이 실제로 흘러간 곳을 확인합니다." },
  { title: "섹터", desc: "10개 섹터의 5일 수익률과 거래량으로 자금이 도착한 업종을 사후 확인합니다." },
  { title: "심리 필터", desc: "기관·내부자 매집과 VIX·공포탐욕지수로 판단이 큰손과 일치하는지 대조합니다. 참고용입니다." },
  { title: "최종 결론", desc: "앞선 다섯 단계를 가중합해 매수·지켜보기·현금비중늘리기 중 오늘의 결론을 계산합니다." },
];

function fearGreedLabel(value: number): { label: string; color: "pos" | "neg" | "neutral" } {
  if (value <= 24) return { label: "극단적 공포", color: "neg" };
  if (value <= 44) return { label: "공포", color: "neg" };
  if (value <= 55) return { label: "중립", color: "neutral" };
  if (value <= 75) return { label: "탐욕", color: "pos" };
  return { label: "극단적 탐욕", color: "pos" };
}

function relativeTime(date: Date | null): string {
  if (!date) return "";
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  return `${Math.round(diffHour / 24)}일 전`;
}

export default async function LandingPage() {
  const [usdkrwRecent, usdkrwYear, fearGreedMetric, worldEconomyNews, domesticEconomyNews] = await Promise.all([
    getMetricHistoryByCount(METRICS.USDKRW, 15),
    getMetricHistory(METRICS.USDKRW, 365),
    getLatestMetric(METRICS.CNN_FEAR_GREED),
    getNewsPageCategory("world-economy", 4),
    getNewsPageCategory("domestic-economy", 4),
  ]);

  const latestFx = usdkrwRecent.at(-1) ?? null;
  const prevFx = usdkrwRecent.length >= 2 ? usdkrwRecent.at(-2)! : null;
  const fxChange = latestFx && prevFx ? latestFx.value - prevFx.value : null;
  const fxChangePct = latestFx && prevFx ? (fxChange! / prevFx.value) * 100 : null;
  const fxHigh = usdkrwYear.length > 0 ? Math.max(...usdkrwYear.map((r) => r.value)) : null;
  const fxLow = usdkrwYear.length > 0 ? Math.min(...usdkrwYear.map((r) => r.value)) : null;
  const fxBarMax = usdkrwRecent.length > 0 ? Math.max(...usdkrwRecent.map((r) => r.value)) : 0;
  const fxBarMin = usdkrwRecent.length > 0 ? Math.min(...usdkrwRecent.map((r) => r.value)) : 0;
  const fxBarRange = fxBarMax - fxBarMin || 1;

  const fearGreedValue = fearGreedMetric?.value ?? null;
  const fearGreed = fearGreedValue !== null ? fearGreedLabel(fearGreedValue) : null;

  const news = [...worldEconomyNews, ...domesticEconomyNews]
    .sort((a, b) => {
      const at = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bt = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return bt - at;
    })
    .slice(0, 4);

  return (
    <div
      className={`${styles.page} ${ibmPlexMono.variable} ${mrsSaintDelafield.variable}`}
      style={{
        // Gothic A1 · IBM Plex Sans KR(한글 포함)은 next/font가 아니라 아래 <link>로 불러온
        // Google Fonts CSS를 그대로 참조한다 — home-fonts.ts 주석 참고.
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
      <header className={styles.header}>
        <span className={styles.brand__logo}>Macroeconomic Analysis</span>
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className={item.current ? styles.navCurrent : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <HomeThemeToggle />
      </header>

      <div className={styles.wrap}>
        <section className={styles.hero}>
          <span className={styles.hero__eyebrow}>매일 아침 9시, 자본이 움직이는 흐름을 점검합니다</span>
          <h1 className={styles.hero__title}>
            데이터로 확인하는
            <br />
            오늘의 자본 흐름
          </h1>
          <p className={styles.hero__desc}>
            <span>뉴스·유동성·환율·자금 흐름을 여덟 개의 단계로 순차 점검합니다.</span>
            <span>감정을 배제한 결정론적 규칙과 실제 시장 데이터로만 판단합니다.</span>
          </p>
          <div className={styles.hero__ctaRow}>
            <Link className={`${styles.btn} ${styles["btn--primary"]}`} href="/report">
              오늘의 리포트 읽기
            </Link>
            <Link className={`${styles.btn} ${styles["btn--ghost"]}`} href="/calendar">
              캘린더 보기
            </Link>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.widgetGrid}>
            <div className={styles.card}>
              <div className={styles.fxCard__head}>환율 · 원/달러 (USD/KRW)</div>
              <div className={styles.fxCard__value}>
                <b>{latestFx ? latestFx.value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "확인 못함"}</b>
                {fxChange !== null && fxChangePct !== null && (
                  <span className={styles.fxCard__change} style={{ color: fxChange >= 0 ? "var(--pos)" : "var(--neg)" }}>
                    {fxChange >= 0 ? "+" : ""}
                    {fxChange.toFixed(2)} ({fxChangePct >= 0 ? "+" : ""}
                    {fxChangePct.toFixed(2)}%)
                  </span>
                )}
              </div>
              <div className={styles.fxCard__range}>
                {fxHigh !== null && fxLow !== null
                  ? `52주 최고 ${fxHigh.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · 52주 최저 ${fxLow.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : "52주 최고·최저 확인 못함"}
              </div>
              {usdkrwRecent.length > 1 && (
                <div className={styles.fxCard__bars} aria-hidden="true">
                  {usdkrwRecent.map((r, i) => (
                    <i
                      key={r.date.toISOString()}
                      className={i === usdkrwRecent.length - 1 ? styles.isLast : undefined}
                      style={{ height: `${Math.max(((r.value - fxBarMin) / fxBarRange) * 100, 8)}%` }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className={styles.card}>
              <div className={styles.fgCard__head}>CNN 공포 · 탐욕 지수</div>
              <div className={styles.fgCard__value}>
                <b>{fearGreedValue !== null ? Math.round(fearGreedValue) : "확인 못함"}</b>
                {fearGreed && (
                  <span className={styles.fgCard__tag} style={{ color: `var(--${fearGreed.color === "neutral" ? "ink-dim" : fearGreed.color})` }}>
                    {fearGreed.label}
                  </span>
                )}
              </div>
              {fearGreedValue !== null && (
                <div className={styles.fgCard__gauge}>
                  <span className={styles.fgCard__marker} style={{ left: `${fearGreedValue}%` }} />
                </div>
              )}
              <div className={styles.fgCard__labels}>
                <span>극단적 공포</span>
                <span>공포</span>
                <span>중립</span>
                <span>탐욕</span>
                <span>극단적 탐욕</span>
              </div>
            </div>
          </div>
        </section>

        {news.length > 0 && (
          <section className={styles.section}>
            <div className={styles.card} style={{ padding: "1.5rem clamp(1.25rem,3vw,2rem)" }}>
              <div className={styles.section__head}>
                <h2 className={styles.section__title}>실시간 뉴스 · 속보</h2>
                <Link className={styles.section__more} href="/news">
                  더보기 →
                </Link>
              </div>
              <div className={styles.newsList}>
                {news.map((n) => (
                  <a key={n.url} className={styles.newsRow} href={n.url} target="_blank" rel="noopener noreferrer">
                    <div className={styles.newsRow__title}>{n.title}</div>
                    <div className={styles.newsRow__meta}>
                      {n.source}
                      {n.publishedAt ? ` · ${relativeTime(new Date(n.publishedAt))}` : ""}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className={styles.section}>
          <div className={styles.section__head}>
            <h2 className={styles.section__title}>우리는 이렇게 분석합니다 — 여덟 개의 점검 단계</h2>
          </div>
          <div className={styles.stepGrid}>
            {STEPS.map((step, i) => (
              <div key={step.title} className={styles.stepCard}>
                <div className={styles.stepCard__num}>{String(i + 1).padStart(2, "0")}</div>
                <div className={styles.stepCard__title}>{step.title}</div>
                <p className={styles.stepCard__desc}>{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className={styles.footer}>
          결정론적 규칙과 실시간 시장 데이터로만 계산합니다 · 투자 조언이 아닙니다 · © 2026 Macroeconomic Analysis
        </footer>
      </div>
    </div>
  );
}
