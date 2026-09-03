// learning-distill.ts가 만드는 개별 기관 LearningNote를 매주 한 번 더 LLM으로 압축해
// "이번 주 학습 요약" 하나로 만든다. 매일 리포트 프롬프트가 원문 노트를 통째로 재전송하지
// 않고 이 압축본 1건만 재사용하게 하기 위함(설계 문서
// docs/superpowers/specs/2026-09-02-learning-application-design.md 참고) — 컨텍스트 길이
// 자체는 문제가 아니었지만(mistral-small-latest 실측 한도 262K 토큰), 비용·지연·
// 플레이스홀더 준수율 저하 위험을 줄이기 위해 압축한다.
import { db } from "@/lib/db";
import { callMistral } from "@/lib/llm-clients";
import { toPlainSentenceLines } from "@/lib/text-format";
import { isoWeekKey } from "@/lib/learning-distill";

type NoteForSynthesis = { category: string; sourceName: string; summary: string };

export function buildSynthesisPrompt(notes: NoteForSynthesis[]): string {
  const body = notes.map((n) => `[${n.category}/${n.sourceName}]\n${n.summary}`).join("\n\n");
  return `너는 여러 기관의 리서치를 종합하는 애널리스트다. 아래는 이번 주 여러 기관(증권사·
중앙은행·국제기구·자산운용사 등)에서 뽑은 학습 노트 ${notes.length}건이다. 각 노트는 그 기관이
①어떤 지표를 근거로 쓰는지, ②어떤 논리로 결론에 도달하는지, ③어떤 형식으로 보고하는지, ④실제로
어떤 내용을 다뤘는지를 담고 있다.

이 노트 전체를 하나로 종합해 "이번 주 학습 요약"을 한국어 6~10문장으로 써라.

*** 규칙 ***
- 개별 기관 이름을 문장의 주어로 쓰지 마라(예: "PIMCO는 ~라고 했다" 금지) — "여러 기관이
  공통으로 ~하는 경향을 보였다", "이번 주 리서치에서는 ~가 자주 다뤄졌다"처럼 전체 경향으로
  종합해라.
- 지표·사고방식·보고 형식의 경향뿐 아니라, 실제로 어떤 주제·수치·전망이 많이 다뤄졌는지(배경
  지식)도 반드시 포함해라.
- 굵게(**) 표시나 마크다운 서식, 번호를 쓰지 마라 — 일반 텍스트로만 써라.
- 데이터에 없는 내용을 지어내지 마라.

학습 노트:
${body}`;
}

/** 이번 주 LearningNote 전체를 압축해 WeeklyLearningSynthesis에 저장한다. 노트가 하나도
 * 없으면(신규 배포 첫 주 등) null을 반환하고 아무것도 저장하지 않는다 — 에러 아님. */
export async function synthesizeWeeklyLearning(): Promise<{ periodKey: string; content: string } | null> {
  const periodKey = isoWeekKey(new Date());
  const notes = await db.learningNote.findMany({ where: { periodKey } });
  if (notes.length === 0) return null;

  const raw = await callMistral(buildSynthesisPrompt(notes), 1536, 0.3);
  const content = toPlainSentenceLines(raw);

  await db.weeklyLearningSynthesis.upsert({
    where: { periodKey },
    create: { periodKey, content },
    update: { content },
  });

  return { periodKey, content };
}
