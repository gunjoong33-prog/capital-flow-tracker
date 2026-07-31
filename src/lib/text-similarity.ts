// 제목 기반 근접중복 판정 — Jaccard 토큰 유사도. news-feeds.ts(공식 발표 dedup)와
// news-events.ts(청크로 나눠 LLM 판정한 결과의 교차 청크 dedup)에서 공통으로 쓴다.

const STOPWORDS = new Set([
  "the", "a", "an", "of", "on", "in", "to", "for", "with", "and", "or", "as", "is", "are", "that",
  "this", "by", "from", "at", "be", "was", "were", "has", "have", "had", "will", "would", "our",
  "their", "its", "president", "donald", "trump",
]);

export function significantTokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** 제목 유사도(기본 임계값 0.25)가 높은 항목을 걸러 대표 1건만 남긴다(먼저 나온 항목 우선). */
export function dedupBySimilarTitle<T>(items: T[], getTitle: (item: T) => string, threshold = 0.25): T[] {
  const kept: T[] = [];
  const keptTokens: Set<string>[] = [];
  for (const item of items) {
    const tokens = significantTokens(getTitle(item));
    const isDup = keptTokens.some((k) => jaccardSimilarity(tokens, k) >= threshold);
    if (!isDup) {
      kept.push(item);
      keptTokens.push(tokens);
    }
  }
  return kept;
}
