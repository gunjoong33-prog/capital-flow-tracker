// 이미 저장된 NewsEvent 중 "같은 사건, 다른 매체 URL" 근접 중복을 Gemini로 판별해 정리한다.
// URL 정규화 dedup(news-events.ts getRecentRiskyNews)은 완전히 같은 URL만 잡아서, 구글 뉴스가
// 같은 사건을 여러 언론사 기사로 재수집한 경우(예: WSJ·Stocktwits가 같은 시장 반응을 각자 보도)는
// 못 걸러낸다. judgeHeadlines() 프롬프트에 중복 제외 지침을 추가했지만 그건 "앞으로" 수집되는
// 뉴스에만 적용되니, 이미 저장된 최근 7일치는 이 스크립트로 한 번 정리한다.
// 실행: npx tsx scripts/dedup-existing-news.ts [--dry-run]
import "dotenv/config";
import { db } from "../src/lib/db";

const GEMINI_MODEL = "gemini-flash-latest";

async function findDuplicateGroups(items: { id: string; title: string; priority: number; date: Date }[]): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || items.length < 2) return [];

  const list = items.map((it, i) => `${i + 1}. [priority=${it.priority}] ${it.title}`).join("\n");
  const prompt = `아래는 최근 리스크 뉴스 헤드라인 목록이다. 같은 사건을 다루는 헤드라인끼리 그룹으로 묶어라
(예: 구글 뉴스가 같은 사건을 여러 언론사 기사로 재수집한 경우, 백악관 공식 발표와 그걸 보도한 기사가
같이 있는 경우). 완전히 다른 사건(주제 자체가 다름)은 같은 그룹에 넣지 마라. 2개 이상 겹치는 그룹만
답하고, 단독 항목은 답에서 빼라.

JSON 배열로만 답해라: [[1,2],[4,7]] 형식(각 안쪽 배열이 같은 사건을 다루는 항목 번호들).
겹치는 그룹이 없으면 빈 배열 []만 답해라.

헤드라인 목록:
${list}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini 중복판별 실패: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as { candidates?: { content: { parts: { text: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 7);
  since.setUTCHours(0, 0, 0, 0);

  const items = await db.newsEvent.findMany({
    where: { date: { gte: since } },
    orderBy: [{ priority: "asc" }, { date: "desc" }],
    select: { id: true, title: true, priority: true, date: true, url: true },
  });
  console.log(`최근 7일 뉴스 ${items.length}건 조회`);

  const groups = await findDuplicateGroups(items);
  console.log("중복 그룹:", JSON.stringify(groups));

  const idsToDelete: string[] = [];
  for (const group of groups) {
    const rows = group.map((idx) => items[idx - 1]).filter(Boolean);
    if (rows.length < 2) continue;
    // 대표 선택: priority 낮은(=중요) 순, 같으면 최신 날짜 순 — findMany의 orderBy와 동일 기준이라 첫 번째가 대표.
    const [keep, ...drop] = rows;
    console.log(`대표 유지: "${keep.title.slice(0, 50)}"`);
    for (const d of drop) {
      console.log(`  ↳ 삭제: "${d.title.slice(0, 50)}"`);
      idsToDelete.push(d.id);
    }
  }

  if (idsToDelete.length === 0) {
    console.log("삭제 대상 없음");
  } else if (dryRun) {
    console.log(`[dry-run] ${idsToDelete.length}건 삭제 예정 (실제 삭제 안 함)`);
  } else {
    const result = await db.newsEvent.deleteMany({ where: { id: { in: idsToDelete } } });
    console.log(`${result.count}건 삭제 완료`);
  }
  process.exit(0);
}
main();
