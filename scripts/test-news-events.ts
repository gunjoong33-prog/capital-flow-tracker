import "dotenv/config";
import { db } from "../src/lib/db";
import { syncMajorEvents } from "../src/lib/major-events";
import { syncNewsEvents } from "../src/lib/news-events";

async function main() {
  console.log("주요 이벤트 동기화...");
  const me = await syncMajorEvents();
  console.log("MajorEvent:", me);

  console.log("\n뉴스 수집·판정...");
  const ne = await syncNewsEvents();
  console.log("NewsEvent:", ne);

  const rows = await db.newsEvent.findMany({ orderBy: { date: "desc" } });
  console.log("\n저장된 리스크 뉴스:", JSON.stringify(rows, null, 2));
}

main().then(() => db.$disconnect());
