import { db } from "@/lib/db";
import {
  computeAllNewsPageCategories,
  FETCHABLE_CATEGORIES,
  isEconPoliticsTechRelevant,
  judgeRelevanceByLLM,
  type CategoryHeadline,
  type FetchableCategoryKey,
  type NewsPageCategoryKey,
} from "@/lib/sources/news-feeds";
import { matchTickers } from "@/lib/sources/news-ticker-match";
import { computeNewsReaction } from "@/lib/news-reaction";
import { kstToday } from "@/lib/date";
import type { MarketEventHeadline } from "@/lib/news-market-events";

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

/** 하루 배치(그리고 이제 하루 여러 번 도는 실시간 보강 크론)가 호출 — /news 페이지의 실제 검색
 * 카테고리 4개(주식/경제 발표/중앙은행/뉴스)를 다시 계산해, 오늘 날짜에 아직 없는 헤드라인(url
 * 기준)만 증분 저장한다. "전체"·"중요"는 저장 대상이 아니다(getNewsPageCategory가 이 4개를
 * 읽어 조립하는 가상 뷰).
 *
 * 예전엔 매 실행마다 오늘치를 통째로 지우고 다시 만들었는데, 실시간성을 높이려고 이 함수를
 * 15~30분마다 돌리면 그 방식은 이미 처리된 헤드라인까지 매번 재매칭·재계산해 Yahoo 호출만
 * 낭비한다 — 그래서 이미 저장된 url은 건너뛰고 새로 나타난 것만 처리한다. 하루 첫 실행(DB에
 * 오늘치가 아직 없음)은 결과적으로 예전과 동일하게 동작한다(전부 "새 것"으로 처리됨).
 * 종목·반응 계산은 헤드라인 저장과 완전히 분리된 추가 단계라 이 부분이 실패해도(예: Yahoo
 * 전체 장애) 헤드라인 저장 자체는 그대로 성공한다. */
export async function syncNewsPageHeadlines(): Promise<{ saved: number; errors: string[] }> {
  const errors: string[] = [];
  const today = kstToday();
  let saved = 0;
  const reactionBudget = { count: MAX_REACTIONS_PER_SYNC };

  try {
    const categories = await computeAllNewsPageCategories();

    // 카테고리별 신규(url 기준 미저장) 헤드라인을 먼저 모으고, 관련성 판정은 이번 실행 전체에서
    // 딱 한 번만 호출한다(카테고리마다 호출하면 15~30분 간격 크론에서 Groq 요청 수가 불어난다).
    const perCategoryNew: { key: FetchableCategoryKey; headlines: CategoryHeadline[] }[] = [];
    for (const { key } of FETCHABLE_CATEGORIES) {
      const headlines = categories[key];
      if (headlines.length === 0) continue;

      const existing = await db.newsPageHeadline.findMany({
        where: { date: new Date(today), category: key },
        select: { url: true },
      });
      const existingUrls = new Set(existing.map((r) => r.url));
      const newHeadlines = headlines.filter((h) => !existingUrls.has(h.url));
      if (newHeadlines.length > 0) perCategoryNew.push({ key, headlines: newHeadlines });
    }

    const allNew = perCategoryNew.flatMap((c) => c.headlines);
    let relevantFlags: boolean[];
    try {
      relevantFlags = await judgeRelevanceByLLM(allNew);
    } catch (err) {
      // LLM 판정 실패(네트워크·429·응답 파싱 실패)해도 동기화 전체를 막지 않는다 — 결정론적
      // 키워드 화이트리스트로 폴백한다(news-feeds.ts 주석 참고).
      errors.push(`관련성 LLM 판정 실패, 키워드 폴백 사용: ${err instanceof Error ? err.message : String(err)}`);
      relevantFlags = allNew.map((h) => isEconPoliticsTechRelevant(h.title));
    }
    const relevantUrls = new Set(allNew.filter((_, i) => relevantFlags[i]).map((h) => h.url));

    for (const { key, headlines: candidateHeadlines } of perCategoryNew) {
      const newHeadlines = candidateHeadlines.filter((h) => relevantUrls.has(h.url));
      if (newHeadlines.length === 0) continue;

      await db.newsPageHeadline.createMany({
        data: newHeadlines.map((h, i) => ({
          date: new Date(today),
          category: key,
          rank: i, // 더 이상 정렬 기준 아님(publishedAt desc로 정렬) — 배치 내 원 순서만 참고용 보존
          title: h.title,
          url: h.url,
          source: h.source,
          publishedAt: h.publishedAt ? new Date(h.publishedAt) : null,
        })),
        skipDuplicates: true,
      });
      saved += newHeadlines.length;

      try {
        // 방금 넣은 신규 url들만 id 조회 — 이미 있던 헤드라인은 반응 재계산 안 함(Yahoo 호출 절약).
        const inserted = await db.newsPageHeadline.findMany({
          where: { date: new Date(today), category: key, url: { in: newHeadlines.map((h) => h.url) } },
          select: { id: true, title: true, publishedAt: true },
        });
        const withIds = inserted.map((r) => ({ headlineId: r.id, title: r.title, publishedAt: r.publishedAt }));
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

/** runDailyAnalysis()·computeInstitutionalSignals()가 계산을 끝낸 뒤 호출 — FRED 경제지표 발표
 * 결과·FINRA/DART/Dataroma/OpenInsider 기관 동향을 오늘 날짜 헤드라인으로 추가 저장한다.
 * syncNewsPageHeadlines()와 완전히 분리된 호출이라(그 함수는 이 데이터가 계산되기 전에 이미
 * 끝나 있음, pipeline.ts 순서 참고) 이 함수가 실패해도 구글 뉴스 헤드라인 저장엔 영향 없다.
 * 음수 rank를 줘서 같은 카테고리 탭에서 구글 뉴스 결과보다 항상 위(더 신뢰도 높은 1차 데이터)에
 * 오게 한다. */
export async function saveMarketEventHeadlines(headlines: MarketEventHeadline[]): Promise<{ saved: number; errors: string[] }> {
  const errors: string[] = [];
  if (headlines.length === 0) return { saved: 0, errors };

  const today = kstToday();
  try {
    // 파이프라인이 같은 날 재실행될 수 있다(재시도·수동 재계산) — 지우지 않고 매번 추가만 하면
    // NewsHeadlineTicker 반응 계산이 이미 처리된 행까지 다시 붙어 같은 헤드라인에 중복 반응이
    // 쌓인다(실측 확인). syncNewsPageHeadlines와 동일하게 오늘치 합성 헤드라인(rank<0)만 지우고
    // 다시 만든다 — 구글 뉴스 헤드라인(rank>=0)은 안 건드린다.
    await db.newsPageHeadline.deleteMany({ where: { date: new Date(today), rank: { lt: 0 } } });

    await db.newsPageHeadline.createMany({
      data: headlines.map((h, i) => ({
        date: new Date(today),
        category: h.category,
        rank: -(i + 1),
        title: h.title,
        url: h.url,
        source: h.source,
        publishedAt: new Date(h.publishedAt),
      })),
      skipDuplicates: true,
    });

    const inserted = await db.newsPageHeadline.findMany({
      where: { date: new Date(today), rank: { lt: 0 } },
      select: { id: true, title: true, publishedAt: true },
    });
    const withIds = inserted.map((r) => ({ headlineId: r.id, title: r.title, publishedAt: r.publishedAt }));
    const reactionBudget = { count: MAX_REACTIONS_PER_SYNC };
    const reactionRows = await computeReactionsForHeadlines(withIds, reactionBudget);
    if (reactionRows.length > 0) await db.newsHeadlineTicker.createMany({ data: reactionRows });

    return { saved: headlines.length, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { saved: 0, errors };
  }
}

function toCategoryHeadline(r: {
  title: string;
  url: string;
  source: string;
  category: string;
  publishedAt: Date | null;
  tickers: { ticker: string; changePct: number | null; asOfLabel: string | null }[];
}): CategoryHeadline {
  return {
    title: r.title,
    url: r.url,
    source: r.source,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    tickers: r.tickers.map((t) => ({ ticker: t.ticker, changePct: t.changePct, asOfLabel: t.asOfLabel })),
    category: r.category as CategoryHeadline["category"],
  };
}

/** /news 페이지가 호출 — 가장 최근에 저장된 날짜의 헤드라인을 읽기만 한다(실시간 조회·LLM 호출 없음).
 * "all"·"important"는 실제 저장된 카테고리가 아니라 4개 실카테고리를 최신 날짜 기준으로 합친
 * 가상 뷰다 — "important"는 그중 종목이 매칭된(tickers 1건 이상) 것만. 전부 시간순(최신
 * publishedAt 먼저)으로 정렬한다 — syncNewsPageHeadlines가 증분 upsert로 바뀌면서 rank는 배치별로
 * 매겨져 실행 간 비교가 불가능해졌으므로(예전엔 "오늘 전체를 한 번에" 만들어 rank가 곧 구글
 * 검색순위였지만, 이제 여러 번에 걸쳐 나눠 들어옴) 개별 카테고리도 rank 대신 publishedAt으로
 * 정렬한다. publishedAt이 없는(드묾) 행은 맨 뒤로 보낸다. */
export async function getNewsPageCategory(key: NewsPageCategoryKey, limit = 20): Promise<CategoryHeadline[]> {
  if (key === "all" || key === "important") {
    const latest = await db.newsPageHeadline.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
    if (!latest) return [];

    const rows = await db.newsPageHeadline.findMany({
      where: {
        date: latest.date,
        ...(key === "important" ? { tickers: { some: {} } } : {}),
      },
      orderBy: { publishedAt: "desc" },
      take: limit,
      include: { tickers: true },
    });
    return rows.map(toCategoryHeadline);
  }

  const latest = await db.newsPageHeadline.findFirst({
    where: { category: key },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return [];

  const rows = await db.newsPageHeadline.findMany({
    where: { category: key, date: latest.date },
    orderBy: { publishedAt: { sort: "desc", nulls: "last" } },
    take: limit,
    include: { tickers: true },
  });
  return rows.map(toCategoryHeadline);
}
