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

function formatPubDate(pubDate: string | null): string {
  if (!pubDate) return "";
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
          <span className={styles.pageHead__eyebrow}>주제별 뉴스</span>
        </div>
        <nav className={styles.tabs}>
          {NEWS_PAGE_CATEGORIES.map((c) => (
            <Link
              key={c.key}
              href={`/news?category=${c.key}`}
              className={`${styles.tab} ${c.key === active.key ? styles.tabActive : ""}`}
            >
              {c.label}
            </Link>
          ))}
        </nav>

        <div className={styles.list}>
          {error && <p className={styles.errorBox}>뉴스를 불러오지 못했습니다 — {error}</p>}
          {!error && headlines.length === 0 && <p className={styles.empty}>표시할 뉴스가 없습니다.</p>}
          {headlines.map((h, i) => (
            <a key={i} href={h.url} target="_blank" rel="noopener noreferrer" className={styles.item}>
              <p className={styles.item__title}>{h.title}</p>
              <p className={styles.item__meta}>
                {h.source}
                {h.publishedAt && ` · ${formatPubDate(h.publishedAt)}`}
              </p>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
