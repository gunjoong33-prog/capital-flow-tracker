// generateNarrative(narrative.ts)에 WeeklyLearningSynthesis(주간 압축본)를 공급하는 DB 접근
// 계층. narrative.ts 자체에 db import를 넣으면 그 유일한 순수 로직 테스트 파일
// (narrative.test.ts)이 db.ts의 "DATABASE_URL 없으면 즉시 throw"에 끌려 들어간다(CI엔
// 시크릿이 없다) — 그래서 DB 접근만 이 파일로 분리한다(external-consensus.ts/
// learning-distill.ts와 같은 오케스트레이션-계층 분리 관례).
//
// 2026-09-02: 최근 LearningNote 5건을 직접 읽던 방식에서, learning-synthesis.ts가 매주 한 번
// 압축해둔 WeeklyLearningSynthesis 1건만 읽는 방식으로 바꿨다 — 매일 4회(narrative·
// comprehensiveReport·periodReport·debug) 호출마다 원문을 통째로 재전송하지 않기 위함.
import { db } from "@/lib/db";

/** 가장 최근 주간 학습 요약을 해설 프롬프트에 참고자료로 얹을 문자열로 반환한다. 없으면 undefined. */
export async function fetchRecentLearningContext(): Promise<string | undefined> {
  const synthesis = await db.weeklyLearningSynthesis.findFirst({ orderBy: { createdAt: "desc" } });
  return synthesis?.content;
}
