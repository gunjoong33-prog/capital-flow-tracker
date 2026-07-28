import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import {
  NEWS_PAGE_CATEGORIES,
  fetchNewsPageCategory,
  type NewsPageCategoryKey,
} from "@/lib/sources/news-feeds";

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

  let headlines: Awaited<ReturnType<typeof fetchNewsPageCategory>> = [];
  let error: string | null = null;
  try {
    headlines = await fetchNewsPageCategory(active.key);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto max-w-3xl space-y-4">
        <SiteNav active="news" />

        <header className="space-y-3">
          <p className="text-sm text-zinc-500">주제별 뉴스</p>
          <nav className="flex flex-wrap gap-2">
            {NEWS_PAGE_CATEGORIES.map((c) => (
              <Link
                key={c.key}
                href={`/news?category=${c.key}`}
                className={
                  "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors " +
                  (c.key === active.key
                    ? "border-zinc-100 bg-zinc-100 text-zinc-900"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200")
                }
              >
                {c.label}
              </Link>
            ))}
          </nav>
        </header>

        <div className="space-y-2">
          {error && (
            <p className="[word-break:keep-all] rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              뉴스를 불러오지 못했습니다 — {error}
            </p>
          )}
          {!error && headlines.length === 0 && (
            <p className="text-sm text-zinc-500">표시할 뉴스가 없습니다.</p>
          )}
          {headlines.map((h, i) => (
            <a
              key={i}
              href={h.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 transition-colors hover:border-zinc-600 hover:bg-zinc-900"
            >
              <p className="[word-break:keep-all] text-sm leading-relaxed text-zinc-200">{h.title}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {h.source}
                {h.publishedAt && ` · ${formatPubDate(h.publishedAt)}`}
              </p>
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}
