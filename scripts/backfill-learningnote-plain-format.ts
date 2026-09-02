// 백필 — 사용자가 "**볼드 삭제, 한 줄에 한 문장씩, AI티 안 나게"로 요청해 learning-distill.ts에
// toPlainSentenceLines() 정리를 추가했다(향후 생성분엔 자동 적용). 이미 저장된 LearningNote는
// 순수 문자열 변환이라 LLM 재호출 없이 그대로 재정리한다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { toPlainSentenceLines } from "../src/lib/text-format";

async function main() {
  const notes = await db.learningNote.findMany({ select: { id: true, summary: true } });
  let changed = 0;
  for (const n of notes) {
    const cleaned = toPlainSentenceLines(n.summary);
    if (cleaned !== n.summary) {
      await db.learningNote.update({ where: { id: n.id }, data: { summary: cleaned } });
      changed++;
    }
  }
  console.log(`총 ${notes.length}건 중 ${changed}건 재정리`);
}

main().then(() => db.$disconnect());
