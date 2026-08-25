// ExternalConsensus 누적 데이터에서 "이 기관은 어떤 지표를 어떤 논리로 해석해 이런 결론에
// 도달했는가"를 LLM으로 distill해 LearningNote에 저장 + 옵시디언 "학습" 폴더로 내보낸다.
// 서술 품질이 중요한 작업이라 narrative.ts와 같은 이유로 Mistral을 쓴다(llm-clients.ts 주석 참고).
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { callMistral } from "@/lib/llm-clients";
import { upsertObsidianFile } from "@/lib/obsidian-export";

// Prisma의 Json 컬럼은 구체 타입을 그대로 받아주지 않으므로(인덱스 시그니처 요구),
// pipeline.ts·external-consensus.ts와 같은 방식으로 캐스팅한다.
const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;

type ConsensusRecord = { id: string; sourceType: string; date: Date; payload: unknown };

const CATEGORY_BY_SOURCE_TYPE: Record<string, string> = {
  "13f": "헤지펀드",
  bis: "은행",
  domestic_broker: "증권사",
  finnhub: "증권사",
  news_quote: "은행",
};

export function buildDistillPrompt(sourceName: string, records: ConsensusRecord[]): string {
  return `너는 매크로 리서치 애널리스트다. 아래는 "${sourceName}"의 최근 공개 데이터다.
이 데이터만 근거로, 이 기관이 어떤 지표를 어떤 논리로 해석해 어떤 결론에 도달했는지 한국어 3~5문장으로 요약해라.
데이터에 없는 내용을 지어내지 마라. 존댓말 아닌 평서체로.

데이터:
${JSON.stringify(records, null, 2)}`;
}

/** 최근 7일간 쌓인 ExternalConsensus를 sourceName별로 묶어 distill하고, DB 저장 + 옵시디언 커밋까지 한다. */
export async function distillAndSaveLearningNotes(): Promise<{ saved: number; errors: string[] }> {
  const errors: string[] = [];
  let saved = 0;

  const since = new Date(Date.now() - 7 * 86_400_000);
  const records = await db.externalConsensus.findMany({ where: { date: { gte: since } } });

  const bySource = new Map<string, ConsensusRecord[]>();
  for (const r of records) {
    const list = bySource.get(r.sourceName) ?? [];
    list.push({ id: r.id, sourceType: r.sourceType, date: r.date, payload: r.payload });
    bySource.set(r.sourceName, list);
  }

  const githubToken = process.env.GITHUB_EXPORT_TOKEN;

  for (const [sourceName, sourceRecords] of bySource) {
    let summary: string;
    try {
      summary = await callMistral(buildDistillPrompt(sourceName, sourceRecords), 1024, 0.3);
    } catch (e) {
      errors.push(`Mistral distill 실패(${sourceName}): ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const category = CATEGORY_BY_SOURCE_TYPE[sourceRecords[0].sourceType] ?? "증권사";

    const note = await db.learningNote.create({
      data: { category, sourceName, summary, basedOn: asJson(sourceRecords.map((r) => r.id)) },
    });
    saved++;

    if (githubToken) {
      const repoPath = `obsidian-export/학습/${category}/${sourceName}.md`;
      const content = `# ${sourceName}\n\n**분류**: ${category}\n**최종 업데이트**: ${note.createdAt.toISOString().slice(0, 10)}\n\n${summary}\n`;
      const { status, detail } = await upsertObsidianFile(repoPath, content, githubToken);
      if (status === "error") errors.push(`옵시디언 커밋 실패(${sourceName}): ${detail ?? "알 수 없는 오류"}`);
    }
  }

  return { saved, errors };
}
