// generateNarrative(narrative.ts)에 LearningNote 컨텍스트를 공급하는 DB 접근 계층.
// narrative.ts 자체에 db import를 넣으면 그 유일한 순수 로직 테스트 파일(narrative.test.ts)이
// db.ts의 "DATABASE_URL 없으면 즉시 throw"에 끌려 들어간다(CI엔 시크릿이 없다 — Global
// Constraints) — 그래서 DB 접근만 이 파일로 분리한다(external-consensus.ts/learning-distill.ts와
// 같은 오케스트레이션-계층 분리 관례).
import { db } from "@/lib/db";

const RECENT_NOTES_LIMIT = 5;

/** 최근 distill된 LearningNote 5건을 해설 프롬프트에 참고자료로 얹을 문자열로 반환한다. 없으면 undefined. */
export async function fetchRecentLearningContext(): Promise<string | undefined> {
  const notes = await db.learningNote.findMany({ orderBy: { createdAt: "desc" }, take: RECENT_NOTES_LIMIT });
  if (notes.length === 0) return undefined;
  return notes.map((n) => `[${n.category}/${n.sourceName}] ${n.summary}`).join("\n\n");
}
