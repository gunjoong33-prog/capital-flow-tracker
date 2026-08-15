import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import {
  NEWS_PAGE_CATEGORIES,
  type NewsPageCategoryKey,
} from "@/lib/sources/news-feeds";
import { getNewsPageCategory } from "@/lib/news-page";
import { ibmPlexMono, mrsSaintDelafield } from "@/lib/site-fonts";
import siteStyles from "@/styles/site.module.css";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

// valley.town 실시간 속보 탭·표의 아이콘과 동일한 역할. "전체"·"중요"는 여러 실카테고리가 섞인
// 뷰라 행마다 실제 출처(h.category)로 아이콘을 고르고, 탭 아이콘 자체는 별도로 둔다.
// 컬러 이모지는 grayscale+brightness(0) 필터를 거치면 "AI티" 나는 컬러가 빠지지만, 배경이
// 불투명한 이모지(예: 막대그래프)는 내부 선까지 뭉개져 단색 사각형처럼 보인다 — 주식 아이콘은
// 노션 아이콘 피커의 "stock"(선그래프) 아이콘과 동일한 모양을 순수 SVG 선으로 직접 그려 항상
// currentColor(검은색)로 또렷하게 나오게 한다.
const StockIcon = () => (
  <svg viewBox="0 0 24 24" className={styles.stockIcon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
    <polyline points="6.5 15.5 10 11.5 13 13.5 17.5 7.5" />
  </svg>
);

const TAB_ICON: Record<NewsPageCategoryKey, React.ReactNode> = {
  all: <span className={styles.emoji}>🗞</span>,
  important: <span className={styles.emoji}>❗</span>,
  stock: <StockIcon />,
  "econ-release": <span className={styles.emoji}>📄</span>,
  "central-bank": <span className={styles.emoji}>🏛</span>,
  news: <span className={styles.emoji}>💬</span>,
};

function formatTimeCell(pubDate: string | null): string {
  if (!pubDate) return "--:--";
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDateCell(pubDate: string | null): string {
  if (!pubDate) return "";
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

function formatChangePct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const active =
    NEWS_PAGE_CATEGORIES.find((c) => c.key === (category as NewsPageCategoryKey)) ?? NEWS_PAGE_CATEGORIES[0];

  let headlines: Awaited<ReturnType<typeof getNewsPageCategory>> = [];
  let error: string | null = null;
  try {
    headlines = await getNewsPageCategory(active.key);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const now = new Date();
  const todayLabel = now.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const nowLabel = now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

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
      <SiteHeader current="news" />

      <div className={siteStyles.wrap}>
        <div className={styles.pageHead}>
          <span className={styles.pageHead__eyebrow}>실시간 속보</span>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelTop}>
            <nav className={styles.tabs}>
              {NEWS_PAGE_CATEGORIES.map((c) => (
                <Link
                  key={c.key}
                  href={`/news?category=${c.key}`}
                  className={`${styles.tab} ${c.key === active.key ? styles.tabActive : ""}`}
                >
                  {TAB_ICON[c.key]}
                  <span>{c.label}</span>
                </Link>
              ))}
            </nav>
          </div>

          <div className={styles.panelMeta}>
            <span className={styles.panelMeta__date}>{todayLabel}</span>
            <span className={styles.panelMeta__clock}><span className={styles.emoji}>🕐</span> {nowLabel} 페이지 생성 시각(KST) · 헤드라인은 하루 1회 배치 갱신</span>
          </div>

          {error && <p className={styles.errorBox}>뉴스를 불러오지 못했습니다 — {error}</p>}
          {!error && headlines.length === 0 && <p className={styles.empty}>표시할 뉴스가 없습니다.</p>}

          {!error && headlines.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.thTime}>시간</th>
                    <th className={styles.thCategory}>분류</th>
                    <th>내용</th>
                    <th className={styles.thSource}>출처</th>
                  </tr>
                </thead>
                <tbody>
                  {headlines.map((h, i) => {
                    const tickers = h.tickers ?? [];
                    const rowCategory = h.category ? NEWS_PAGE_CATEGORIES.find((c) => c.key === h.category) : undefined;
                    return (
                      <tr key={i}>
                        <td className={styles.timeCell}>
                          <span className={styles.timeCell__time}>{formatTimeCell(h.publishedAt)}</span>
                          <span className={styles.timeCell__date}>{formatDateCell(h.publishedAt)}</span>
                        </td>
                        <td className={styles.categoryCell} aria-label={rowCategory?.label ?? active.label}>
                          {h.category ? TAB_ICON[h.category] : TAB_ICON[active.key]}
                        </td>
                        <td className={styles.contentCell}>
                          {h.url.startsWith("/") ? (
                            <Link href={h.url} className={styles.contentCell__title}>
                              {h.title}
                            </Link>
                          ) : (
                            <a href={h.url} target="_blank" rel="noopener noreferrer" className={styles.contentCell__title}>
                              {h.title}
                            </a>
                          )}
                          {tickers.length > 0 && (
                            <div className={styles.tickerRow}>
                              {tickers.map((t) => (
                                <span
                                  key={t.ticker}
                                  className={styles.tickerBadge}
                                  data-direction={t.changePct === null ? "unknown" : t.changePct >= 0 ? "up" : "down"}
                                  title={t.asOfLabel ?? undefined}
                                >
                                  {t.ticker} {t.changePct === null ? "확인 못함" : formatChangePct(t.changePct)}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className={styles.sourceCell}>{h.source}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
