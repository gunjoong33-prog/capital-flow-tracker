// DailyReport·PeriodReport → 옵시디언용 마크다운 변환. 로컬 스크립트(scripts/export-reports-to-obsidian.ts)와
// 클라우드 크론(api/cron/obsidian-export)이 이 파일을 공유해서 포맷이 절대 어긋나지 않게 한다.
import type { DailyReport, PeriodReport } from "@/generated/prisma/client";
import type { StepDetailRow, StepDetails } from "@/lib/scoring/types";

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

export function dailyReportFileName(row: Pick<DailyReport, "date">): string {
  return `${row.date.toISOString().slice(0, 10)}.md`;
}

export function buildDailyReportMarkdown(row: DailyReport): string {
  const dateStr = row.date.toISOString().slice(0, 10);
  const marketDateStr = row.marketDate?.toISOString().slice(0, 10) ?? "확인 못함";
  const details = (row.details ?? {}) as unknown as StepDetails;
  const step2 = row.step2 as unknown as { finalScore: number };
  const step3 = row.step3 as unknown as { score: number };
  const step4 = row.step4 as unknown as { score: number };
  const step5 = row.step5 as unknown as { score: number };
  const step6 = row.step6 as unknown as { score: number };
  const step8 = row.step8 as unknown as { macroTrendScore: number; finalDecision: string; vetoApplied: boolean; positionSizePct: number | null; cashAllocationPct?: number | null };

  let md = `# ${dateStr} 자본흐름 리포트\n\n`;
  md += `- marketDate(실제 반영 미국장 거래일): ${marketDateStr}\n`;
  md += `- 최종 결론: **${step8.finalDecision}**\n`;
  md += `- 투자 적합도 점수: **${step8.macroTrendScore.toFixed(2)}**\n`;
  md += `- 거부권 발동: ${step8.vetoApplied ? "예" : "아니오"}\n`;
  if (step8.positionSizePct !== null) md += `- 권장 매수 비중: ${step8.positionSizePct}%\n`;
  if (step8.cashAllocationPct != null) md += `- 참고 현금 비중: ${step8.cashAllocationPct}%\n`;
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

  return md;
}

const PERIOD_TYPE_LABEL: Record<string, string> = { week: "주간", month: "월간", quarter: "분기", year: "연간" };

const GITHUB_OWNER = "gunjoong33-prog";
const GITHUB_REPO = "capital-flow-tracker";
const GITHUB_BRANCH = "master";

async function githubRequest(path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
}

/** 내용이 실제로 바뀐 파일만 커밋한다 — api/cron/obsidian-export와 exportDailyReportNow가 공유해서
 * GitHub Contents API 호출부가 두 곳에서 따로 어긋나지 않게 한다. */
export async function upsertObsidianFile(repoPath: string, content: string, token: string): Promise<"created" | "updated" | "unchanged" | "error"> {
  const encodedPath = repoPath.split("/").map(encodeURIComponent).join("/");
  const contentBase64 = Buffer.from(content, "utf8").toString("base64");

  const getRes = await githubRequest(`${encodedPath}?ref=${GITHUB_BRANCH}`, token);
  let sha: string | undefined;
  if (getRes.ok) {
    const existing = (await getRes.json()) as { sha: string; content: string };
    const existingContent = Buffer.from(existing.content, "base64").toString("utf8");
    if (existingContent === content) return "unchanged";
    sha = existing.sha;
  } else if (getRes.status !== 404) {
    return "error";
  }

  const putRes = await githubRequest(encodedPath, token, {
    method: "PUT",
    body: JSON.stringify({
      message: `옵시디언 export: ${repoPath}`,
      content: contentBase64,
      branch: GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  return putRes.ok ? (sha ? "updated" : "created") : "error";
}

/**
 * 당일 파이프라인이 DailyReport를 저장한 직후 바로 호출한다 — 09:30 별도 cron-job.org 크론이 그날
 * 아예 안 도는 실패 케이스(2026-08-13 실측: 리포트는 08:52에 이미 저장됐는데 obsidian-export 크론
 * 자체가 안 돌아서 하루 넘게 반영이 밀림)에도, 리포트 생성 성공 즉시 같은 요청 안에서 GitHub에
 * 커밋해버리면 별도 크론의 타이밍에 더 이상 의존하지 않는다. 09:30 크론은 이후 백필·주기별 리포트
 * 재확인용 안전망으로 계속 남겨둔다(제거하지 않음).
 */
export async function exportDailyReportNow(row: DailyReport): Promise<void> {
  const token = process.env.GITHUB_EXPORT_TOKEN;
  if (!token) throw new Error("GITHUB_EXPORT_TOKEN 환경변수 없음");
  const repoPath = `obsidian-export/일일 리포트/${dailyReportFileName(row)}`;
  const status = await upsertObsidianFile(repoPath, buildDailyReportMarkdown(row), token);
  if (status === "error") throw new Error(`GitHub 커밋 실패: ${repoPath}`);
}

export function periodReportFileName(row: Pick<PeriodReport, "periodType" | "periodStart">): string {
  return `${row.periodType}-${row.periodStart.toISOString().slice(0, 10)}.md`;
}

export function buildPeriodReportMarkdown(row: PeriodReport): string {
  const startStr = row.periodStart.toISOString().slice(0, 10);
  const endStr = row.periodEnd.toISOString().slice(0, 10);
  const summary = row.summary as unknown as Record<string, unknown>;
  const label = PERIOD_TYPE_LABEL[row.periodType] ?? row.periodType;

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

  return md;
}
