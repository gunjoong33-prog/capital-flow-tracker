import { db } from "@/lib/db";
import {
  computeAllNewsPageCategories,
  NEWS_PAGE_CATEGORIES,
  type CategoryHeadline,
  type NewsPageCategoryKey,
} from "@/lib/sources/news-feeds";
import { matchTickers } from "@/lib/sources/news-ticker-match";
import { computeNewsReaction } from "@/lib/news-reaction";
import { kstToday } from "@/lib/date";

// 하루치 헤드라인(최대 5개 카테고리 × 20건 = 100건) 중 실제로 종목이 매칭된 것만 반응을 계산해도
// 상한 없이 다 계산하면 Yahoo 비공식 API에 짧은 시간 안에 몰아치게 된다 — 하루 배치 전체에 걸리는
// 총 계산 건수를 제한해 방어한다. 예산을 넘긴 매칭은 "종목 뱃지는 있지만 반응 없음"으로 남는다.
const MAX_REACTIONS_PER_SYNC = 30;
const REACTION_CONCURRENCY = 4; // Yahoo에 순간적으로 몰아치지 않도록 동시 요청 수 제한

async function computeReactionsForHeadlines(
  headlines: { headlineId: string; title: string; publishedAt: Date | null }[],
  remainingBudget: { count: number }
): Promise<{ headlineId: string; ticker: string; changePct: number | null; asOfLabel: string | null }[]> {
  const jobs: { headlineId: string; ticker: string; yahooSymbol: string; publishedAt: Date }[] = [];
  for (const h of headlines) {
    if (!h.publishedAt || remainingBudget.count <= 0) continue;
    for (const m of matchTickers(h.title)) {
      if (remainingBudget.count <= 0) break;
      jobs.push({ headlineId: h.headlineId, ticker: m.code, yahooSymbol: m.yahooSymbol, publishedAt: h.publishedAt });
      remainingBudget.count--;
    }
  }

  const rows: { headlineId: string; ticker: string; changePct: number | null; asOfLabel: string | null }[] = [];
  for (let i = 0; i < jobs.length; i += REACTION_CONCURRENCY) {
    const chunk = jobs.slice(i, i + REACTION_CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((j) => computeNewsReaction(j.ticker, j.yahooSymbol, j.publishedAt)));
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") rows.push({ headlineId: chunk[idx].headlineId, ...r.value });
      // rejected는 조용히 생략 — computeNewsReaction 자체가 이미 실패를 fallback으로 삼키므로
      // 여기서 reject가 나면 코드 버그일 가능성이 높다. 그래도 다른 종목 계산은 막지 않는다.
    });
  }
  return rows;
}

/** 하루 배치가 호출 — /news 페이지 5개 카테고리를 계산해 오늘 날짜로 저장하고, 매칭된 종목의
 * 시장 반응(NewsHeadlineTicker)도 함께 채운다. 종목·반응 계산은 기존 헤드라인 저장과 완전히
 * 분리된 추가 단계라 이 부분이 실패해도(예: Yahoo 전체 장애) 헤드라인 저장 자체는 그대로 성공한다. */
export async function syncNewsPageHeadlines(): Promise<{ saved: number; errors: string[] }> {
  const errors: string[] = [];
  const today = kstToday();
  let saved = 0;
  const reactionBudget = { count: MAX_REACTIONS_PER_SYNC };

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

      // 방금 저장한 행의 id가 필요해(createMany는 생성된 행을 안 돌려준다) 같은 순서(rank asc)로
      // 다시 읽어와 원본 headlines 배열과 인덱스로 짝짓는다.
      try {
        const inserted = await db.newsPageHeadline.findMany({
          where: { date: new Date(today), category: key },
          orderBy: { rank: "asc" },
          select: { id: true },
        });
        const withIds = inserted.map((row, i) => ({
          headlineId: row.id,
          title: headlines[i]?.title ?? "",
          publishedAt: headlines[i]?.publishedAt ? new Date(headlines[i].publishedAt!) : null,
        }));
        const reactionRows = await computeReactionsForHeadlines(withIds, reactionBudget);
        if (reactionRows.length > 0) {
          await db.newsHeadlineTicker.createMany({ data: reactionRows });
        }
      } catch (err) {
        // 종목/반응 계산 실패는 헤드라인 저장 자체를 막지 않는다 — 에러만 기록.
        errors.push(`[${key}] 종목 반응 계산 실패: ${err instanceof Error ? err.message : String(err)}`);
      }
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
    include: { tickers: true },
  });

  return rows.map((r) => ({
    title: r.title,
    url: r.url,
    source: r.source,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    tickers: r.tickers.map((t) => ({ ticker: t.ticker, changePct: t.changePct, asOfLabel: t.asOfLabel })),
  }));
}
