import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  const metric = process.argv[2];
  const date = process.argv[3] ?? new Date().toISOString().slice(0, 10);
  const r = await db.manualInputLog.deleteMany({ where: { metric, date: new Date(date) } });
  console.log(`삭제됨: ${r.count}`);
}

main().then(() => db.$disconnect());
