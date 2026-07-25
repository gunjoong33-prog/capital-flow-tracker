import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  const rows = await db.manualInputLog.findMany({
    where: { metric: "DOMESTIC_WEIGHT_HIGH" },
    orderBy: { date: "desc" },
  });
  console.log(JSON.stringify(rows, null, 2));
}

main().then(() => db.$disconnect());
