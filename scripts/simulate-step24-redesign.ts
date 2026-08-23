// 읽기 전용 — 2·4단계 재설계가 실제 점수 분포를 어떻게 바꾸는지. 저장된 리포트의 단계 점수를
// 그대로 두고, 2·4단계만 새 방식으로 갈아끼웠을 때 총점이 어디로 가는지 본다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { WEIGHTS, TOTAL_WEIGHT, decisionFromScore } from "../src/lib/scoring/pure";
import type { Step8Result } from "../src/lib/scoring/types";

const g = (o: unknown, k: string) => (o as Record<string, number>)[k];

async function main() {
  const rows = await db.dailyReport.findMany({ orderBy: { date: "asc" }, select: { date: true, step2: true, step3: true, step4: true, step5: true, step6: true, step8: true } });
  console.log("날짜        | 2단계 전->후 | 4단계 전->후 | 총점 전->후 | 결론 변화");
  const before: number[] = [], after: number[] = [];
  let changed = 0;
  for (const r of rows) {
    const s8 = r.step8 as unknown as Step8Result;
    const s2old = g(r.step2, "finalScore");
    const s4old = g(r.step4, "score");

    // 2단계: 저장된 "충족 개수/유효 개수"만 남아 있어 강도 원본을 복원할 수 없다. 부분 충족이
    // 평균적으로 절반 정도 존재한다고 보고, 미충족 항목의 절반을 0.5로 가정한 하한 추정치를 쓴다.
    const qc = g(r.step2, "overseasQualifyingCount"), tc = g(r.step2, "overseasTotalCount");
    const s2new = tc > 0 ? ((qc + (tc - qc) * 0.5) / tc) * 10 : 5;

    // 4단계: 변화량 없이 방향만 남아 있으므로 꼭짓점 그대로(= 변화 없음). 연속화 효과는 앞으로만.
    const s4new = s4old;

    const w = (s2: number, s4: number) =>
      (s2 * WEIGHTS.step2 + g(r.step3, "score") * WEIGHTS.step3 + s4 * WEIGHTS.step4 +
       g(r.step5, "score") * WEIGHTS.step5 + g(r.step6, "score") * WEIGHTS.step6) / TOTAL_WEIGHT;
    const tOld = w(s2old, s4old), tNew = w(s2new, s4new);
    before.push(tOld); after.push(tNew);
    const dOld = decisionFromScore(tOld), dNew = decisionFromScore(tNew);
    if (dOld !== dNew) changed++;
    console.log(`${r.date.toISOString().slice(0,10)} | ${s2old.toFixed(2)} -> ${s2new.toFixed(2)} | ${s4old.toFixed(2)} -> ${s4new.toFixed(2)} | ${tOld.toFixed(2)} -> ${tNew.toFixed(2)} | ${dOld === dNew ? "" : `${dOld} -> ${dNew}`}`);
  }
  const m = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`\n총점 평균 ${m(before).toFixed(2)} -> ${m(after).toFixed(2)}`);
  console.log(`총점 최대 ${Math.max(...before).toFixed(2)} -> ${Math.max(...after).toFixed(2)} (지켜보기 5.0 / 매수 7.0)`);
  console.log(`5.0 이상인 날 ${before.filter(v=>v>=5).length} -> ${after.filter(v=>v>=5).length}`);
  console.log(`원점수 결론이 바뀐 날: ${changed}/${rows.length}`);
}
main().finally(() => db.$disconnect());
