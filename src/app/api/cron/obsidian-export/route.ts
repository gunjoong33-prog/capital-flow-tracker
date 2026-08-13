import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildDailyReportMarkdown, buildPeriodReportMarkdown, dailyReportFileName, periodReportFileName, upsertObsidianFile } from "@/lib/obsidian-export";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 옵시디언 vault는 이 PC 로컬 폴더라 Vercel 서버가 직접 못 쓴다 — 대신 이 리포지토리의
 * obsidian-export/ 폴더에 GitHub Contents API로 커밋해두고, 로컬에서는 git pull(가벼움, DB 접속
 * 불필요)로 받아오게 한다. 로컬 vault의 "일일 리포트"·"주기별 리포트" 폴더는 이 폴더를 가리키는
 * Windows 디렉터리 접합(mklink /J)이라, git pull 한 번이면 바로 반영된다.
 *
 * PC가 꺼져 있어도 이 크론(cron-job.org → 이 엔드포인트)은 정시에 돈다 — 그게 이 우회의 핵심 목적.
 * GitHub Actions의 schedule 트리거는 이미 이 프로젝트에서 6~10시간씩 지연되는 게 확인돼서
 * ([[capital_flow_tracker_cron_reliability]] 참고) 안 쓴다.
 *
 * 당일 리포트만큼은 pipeline.ts의 exportDailyReportNow()가 리포트 저장 직후 같은 요청 안에서 먼저
 * 커밋해버린다(2026-08-13, 이 09:30 크론 자체가 그날 아예 안 도는 바람에 반영이 하루 밀린 사고 이후
 * 추가) — 그래서 이 크론은 이제 "그래도 당일 커밋이 실패했거나 크론이 안 돈 날"을 다음 실행에서
 * 따라잡는 안전망 역할이고, 단독 반영 경로가 아니다.
 */
async function upsertFile(repoPath: string, content: string): Promise<"created" | "updated" | "unchanged" | "error"> {
  const token = process.env.GITHUB_EXPORT_TOKEN!;
  return upsertObsidianFile(repoPath, content, token);
}

// 매일 전체 리포트를 다시 조회·비교하면(과거 것까지 전부 GET 요청 1번씩) 리포트가 쌓일수록
// 60초 제한 안에 못 끝나게 된다(unchanged라도 GitHub에 존재 확인 GET은 매번 나간다 — 코드
// 감사로 발견). 평상시 크론은 최근 것만 보면 충분하니 기본은 최근 구간으로 좁히고, 과거 리포트를
// 통째로 다시 밀어야 할 때만 ?full=1로 명시적으로 넓힌다.
const DEFAULT_DAILY_LOOKBACK_DAYS = 60;
const DEFAULT_PERIOD_LOOKBACK_COUNT = 12;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;
  if (!process.env.GITHUB_EXPORT_TOKEN) {
    return NextResponse.json({ error: "GITHUB_EXPORT_TOKEN 환경변수 없음" }, { status: 500 });
  }
  const full = new URL(request.url).searchParams.get("full") === "1";

  const results: Record<string, string> = {};
  const errors: string[] = [];

  const dailyRows = await db.dailyReport.findMany({
    orderBy: { date: "asc" },
    ...(full ? {} : { where: { date: { gte: new Date(Date.now() - DEFAULT_DAILY_LOOKBACK_DAYS * 86_400_000) } } }),
  });
  for (const row of dailyRows) {
    const repoPath = `obsidian-export/일일 리포트/${dailyReportFileName(row)}`;
    const status = await upsertFile(repoPath, buildDailyReportMarkdown(row));
    results[repoPath] = status;
    if (status === "error") errors.push(repoPath);
  }

  const periodRows = await db.periodReport.findMany({
    orderBy: { periodStart: "desc" },
    ...(full ? {} : { take: DEFAULT_PERIOD_LOOKBACK_COUNT }),
  });
  for (const row of periodRows) {
    const repoPath = `obsidian-export/주기별 리포트/${periodReportFileName(row)}`;
    const status = await upsertFile(repoPath, buildPeriodReportMarkdown(row));
    results[repoPath] = status;
    if (status === "error") errors.push(repoPath);
  }

  const summary = { created: 0, updated: 0, unchanged: 0, error: 0 };
  for (const status of Object.values(results)) summary[status as keyof typeof summary]++;

  return NextResponse.json({ summary, errors, results });
}
