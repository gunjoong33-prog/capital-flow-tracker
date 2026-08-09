// DailyReport·PeriodReport 전체를 옵시디언 vault(하위 폴더)에 마크다운으로 export한다(로컬 실행용).
// 읽기 전용 — DB는 안 건드림. 매번 덮어쓰기라 재실행해도 안전.
// 자동화(클라우드, PC 꺼져있어도 동작)는 src/app/api/cron/obsidian-export/route.ts가 대신 맡는다 —
// 포맷은 src/lib/obsidian-export.ts를 공유해서 둘이 절대 어긋나지 않는다.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import { buildDailyReportMarkdown, buildPeriodReportMarkdown, dailyReportFileName, periodReportFileName } from "../src/lib/obsidian-export";

const VAULT_ROOT = "C:\\Users\\김건중\\ObsidianVault\\capital-flow-tracker";
const DAILY_DIR = path.join(VAULT_ROOT, "일일 리포트");
const PERIOD_DIR = path.join(VAULT_ROOT, "주기별 리포트");

async function main() {
  fs.mkdirSync(DAILY_DIR, { recursive: true });
  fs.mkdirSync(PERIOD_DIR, { recursive: true });

  const dailyRows = await db.dailyReport.findMany({ orderBy: { date: "asc" } });
  console.log(`일일 리포트 ${dailyRows.length}건 export`);
  for (const row of dailyRows) {
    fs.writeFileSync(path.join(DAILY_DIR, dailyReportFileName(row)), buildDailyReportMarkdown(row), "utf8");
  }

  const periodRows = await db.periodReport.findMany({ orderBy: { periodStart: "asc" } });
  console.log(`주기별 리포트 ${periodRows.length}건 export`);
  for (const row of periodRows) {
    fs.writeFileSync(path.join(PERIOD_DIR, periodReportFileName(row)), buildPeriodReportMarkdown(row), "utf8");
  }

  console.log("완료");
}

main().then(() => db.$disconnect());
