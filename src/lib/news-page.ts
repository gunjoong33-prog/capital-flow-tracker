import { db } from "@/lib/db";
import {
  computeAllNewsPageCategories,
  NEWS_PAGE_CATEGORIES,
  type CategoryHeadline,
  type NewsPageCategoryKey,
} from "@/lib/sources/news-feeds";
import { kstToday } from "@/lib/date";

/** 하루 배치가 호출 — /news 페이지 5개 카테고리를 계산해 오늘 날짜로 저장한다. */
export async function syncNewsPageHeadlines(): Promise<{ saved: number; errors: string[] }> {
  const errors: string[] = [];
  const today = kstToday();
  let saved = 0;

  try {
    const categories = await computeAllNewsPageCategories();
    await db.newsPageHeadline.deleteMany({ where: { date: new Date(today) } });

    for (const { key } of NEWS_PAGE_CATEGORIES) {
      const headlines = categories[key];
      if (headlines.length === 0) continue;
      await db.newsPageHeadline.createMany({
        data: headlines.map((h, i) => ({
          date: new Date(today),
          category: key,
          rank: i,
          title: h.title,
          url: h.url,
          source: h.source,
          publishedAt: h.publishedAt ? new Date(h.publishedAt) : null,
        })),
        skipDuplicates: true,
      });
      saved += headlines.length;
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { saved, errors };
}

/** /news 페이지가 호출 — 가장 최근에 저장된 날짜의 헤드라인을 읽기만 한다(실시간 조회·LLM 호출 없음). */
export async function getNewsPageCategory(key: NewsPageCategoryKey, limit = 20): Promise<CategoryHeadline[]> {
  const latest = await db.newsPageHeadline.findFirst({
    where: { category: key },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return [];

  const rows = await db.newsPageHeadline.findMany({
    where: { category: key, date: latest.date },
    orderBy: { rank: "asc" },
    take: limit,
  });

  return rows.map((r) => ({
    title: r.title,
    url: r.url,
    source: r.source,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
  }));
}
