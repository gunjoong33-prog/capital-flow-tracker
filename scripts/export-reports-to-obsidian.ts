// DailyReport·PeriodReport 전체를 옵시디언 vault(하위 폴더)에 마크다운으로 export한다.
// 읽기 전용 export — DB는 안 건드림. 매번 덮어쓰기라 재실행해도 안전(최신 상태로 갱신됨).
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/lib/db";
import type { StepDetailRow, StepDetails } from "../src/lib/scoring/types";

const VAULT_ROOT = "C:\\Users\\김건중\\ObsidianVault\\capital-flow-tracker";
const DAILY_DIR = path.join(VAULT_ROOT, "일일 리포트");
const PERIOD_DIR = path.join(VAULT_ROOT, "주기별 리포트");

function table(rows: StepDetailRow[] | undefined): string {
  if (!rows || rows.length === 0) return "ـ (데이터 없음)\n";
  const linkMode = rows.some((r) => r.url);
  const header = linkMode
    ? "| 지표 | 기준 | 실제값 | 충족 | 바로가기 |\n|---|---|---|---|---|\n"
    : "| 지표 | 기준 | 실제값 | 충족 |\n|---|---|---|---|\n";
  const lines = rows.map((r) => {
    const met = r.result !== undefined ? r.result : r.met === null ? "-" : r.met ? "✓" : "✕";
    const value = r.value.replace(/\n/g, "<br>").replace(/\|/g, "\\|");
    const criterion = r.criterion.replace(/\n/g, "<br>").replace(/\|/g, "\\|");
    const label = r.label.replace(/\|/g, "\\|");
    const link = linkMode ? ` | ${r.url ? `[확인](${r.url})` : "-"}` : "";
    return `| ${label} | ${criterion} | ${value} | ${met}${link} |`;
  });
  return header + lines.join("\n") + "\n";
}

function stepSection(n: number, title: string, score: number | null, summary: string | undefined, rows: StepDetailRow[] | undefined): string {
  const scoreLabel = score !== null ? ` (점수 ${score.toFixed(2)})` : "";
  let s = `## ${n}단계 · ${title}${scoreLabel}\n\n`;
  if (summary) s += `**종합판단**: ${summary}\n\n`;
  s += table(rows);
  s += "\n";
  return s;
}

async function exportDaily() {
  const rows = await db.dailyReport.findMany({ orderBy: { date: "asc" } });
  console.log(`일일 리포트 ${rows.length}건 export 시작`);
  for (const row of rows) {
    const dateStr = row.date.toISOString().slice(0, 10);
    const marketDateStr = row.marketDate?.toISOString().slice(0, 10) ?? "확인 못함";
    const details = (row.details ?? {}) as unknown as StepDetails;
    const step2 = row.step2 as unknown as { finalScore: number };
    const step3 = row.step3 as unknown as { score: number };
    const step4 = row.step4 as unknown as { score: number };
    const step5 = row.step5 as unknown as { score: number };
    const step6 = row.step6 as unknown as { score: number };
    const step8 = row.step8 as unknown as { macroTrendScore: number; finalDecision: string; vetoApplied: boolean; positionSizePct: number | null };

    let md = `# ${dateStr} 자본흐름 리포트\n\n`;
    md += `- marketDate(실제 반영 미국장 거래일): ${marketDateStr}\n`;
    md += `- 최종 결론: **${step8.finalDecision}**\n`;
    md += `- 투자 적합도 점수: **${step8.macroTrendScore.toFixed(2)}**\n`;
    md += `- 거부권 발동: ${step8.vetoApplied ? "예" : "아니오"}\n`;
    if (step8.positionSizePct !== null) md += `- 권장 매수 비중: ${step8.positionSizePct}%\n`;
    md += "\n";

    if (details.comprehensiveReport) {
      md += `## 종합보고서\n\n${details.comprehensiveReport}\n\n`;
    }

    md += stepSection(1, "글로벌 환경", null, undefined, details.step1);
    md += stepSection(2, "자본의 유동성", step2.finalScore, details.step2Summary, details.step2);
    if (details.step2Aux && details.step2Aux.length > 0) md += `### 보조 지표(집계 제외)\n\n${table(details.step2Aux)}\n`;
    md += stepSection(3, "캐리 트레이드", step3.score, details.step3Summary, details.step3);
    md += stepSection(4, "환율·금·유가", step4.score, details.step4Summary, details.step4);
    if (details.step4Aux && details.step4Aux.length > 0) md += `### 보조 지표(집계 제외)\n\n${table(details.step4Aux)}\n`;
    md += stepSection(5, "규모별·성격별 자금 도착", step5.score, details.step5Summary, details.step5);
    if (details.step5Aux && details.step5Aux.length > 0) md += `### 지수·크립토 마감 시세(집계 제외)\n\n${table(details.step5Aux)}\n`;
    if (details.step5BigTech && details.step5BigTech.length > 0) md += `### 빅테크 7 마감 시세(집계 제외)\n\n${table(details.step5BigTech)}\n`;
    md += stepSection(6, "자본의 최종 목적지(섹터, 사후 확인용)", step6.score, details.step6Summary, details.step6);
    md += `## 7단계 · 심리 필터(합산 제외)\n\n`;
    if (details.step7Summary) md += `**종합판단**: ${details.step7Summary}\n\n`;
    if (details.step7Institutional && details.step7Institutional.length > 0) md += `### 기관·내부자 매집 지표(집계 제외)\n\n${table(details.step7Institutional)}\n`;
    md += `### 공포와 탐욕 지수\n\n${table(details.step7)}\n`;
    md += stepSection(8, "최종 결론 계산", null, undefined, details.step8);

    fs.writeFileSync(path.join(DAILY_DIR, `${dateStr}.md`), md, "utf8");
  }
  console.log("일일 리포트 export 완료");
}

async function exportPeriod() {
  const rows = await db.periodReport.findMany({ orderBy: { periodStart: "asc" } });
  console.log(`주기별 리포트 ${rows.length}건 export 시작`);
  const TYPE_LABEL: Record<string, string> = { week: "주간", month: "월간", quarter: "분기", year: "연간" };
  for (const row of rows) {
    const startStr = row.periodStart.toISOString().slice(0, 10);
    const endStr = row.periodEnd.toISOString().slice(0, 10);
    const summary = row.summary as unknown as Record<string, unknown>;
    const label = TYPE_LABEL[row.periodType] ?? row.periodType;

    let md = `# ${label} 리포트 · ${startStr} ~ ${endStr}\n\n`;
    if (summary.avgMacroTrendScore !== null && summary.avgMacroTrendScore !== undefined) {
      md += `- 평균 투자 적합도 점수: **${summary.avgMacroTrendScore}**\n`;
    }
    if (summary.daysWithData !== undefined) md += `- 데이터 있는 날: ${summary.daysWithData}일\n`;
    md += "\n";

    if (row.comprehensiveReport) {
      md += `## 종합보고서\n\n${row.comprehensiveReport}\n\n`;
    }

    md += `## 집계 원자료(summary JSON)\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`;

    const fileName = `${row.periodType}-${startStr}.md`;
    fs.writeFileSync(path.join(PERIOD_DIR, fileName), md, "utf8");
  }
  console.log("주기별 리포트 export 완료");
}

async function main() {
  fs.mkdirSync(DAILY_DIR, { recursive: true });
  fs.mkdirSync(PERIOD_DIR, { recursive: true });
  await exportDaily();
  await exportPeriod();
}

main().then(() => db.$disconnect());
