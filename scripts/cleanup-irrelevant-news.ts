// 이미 저장된 NewsPageHeadline 중 경제/정치/기술과 무관한 기사를 삭제한다(news-feeds.ts의
// isEconPoliticsTechRelevant 화이트리스트 필터를 앞으로의 수집뿐 아니라 과거 저장분에도 소급 적용).
// rank<0(FRED/기관데이터 기반 합성 헤드라인, saveMarketEventHeadlines가 저장)은 원래 화이트리스트
// 키워드가 문자 그대로 안 들어있어도 항상 경제 관련이라 대상에서 제외한다.
// 실행: npx tsx scripts/cleanup-irrelevant-news.ts [--dry-run]
import "dotenv/config";
import { db } from "../src/lib/db";
import { isEconPoliticsTechRelevant } from "../src/lib/sources/news-feeds";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const rows = await db.newsPageHeadline.findMany({
    where: { rank: { gte: 0 } },
    select: { id: true, title: true, category: true, date: true },
  });
  console.log(`검사 대상 ${rows.length}건 (rank>=0, 구글 뉴스 기반)`);

  const toDelete = rows.filter((r) => !isEconPoliticsTechRelevant(r.title));
  console.log(`무관 판정 ${toDelete.length}건`);
  for (const r of toDelete) {
    console.log(`  [${r.category} ${r.date.toISOString().slice(0, 10)}] ${r.title}`);
  }

  if (toDelete.length === 0) {
    console.log("삭제 대상 없음");
  } else if (dryRun) {
    console.log(`[dry-run] ${toDelete.length}건 삭제 예정 (실제 삭제 안 함)`);
  } else {
    const result = await db.newsPageHeadline.deleteMany({ where: { id: { in: toDelete.map((r) => r.id) } } });
    console.log(`${result.count}건 삭제 완료`);
  }
  process.exit(0);
}
main();
