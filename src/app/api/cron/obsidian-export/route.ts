import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildDailyReportMarkdown, buildPeriodReportMarkdown, dailyReportFileName, periodReportFileName, upsertObsidianFile, type UpsertResult } from "@/lib/obsidian-export";
import { requireCronAuth } from "@/lib/cron-auth";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

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
async function upsertFile(repoPath: string, content: string): Promise<UpsertResult> {
  const token = process.env.GITHUB_EXPORT_TOKEN!;
  return upsertObsidianFile(repoPath, content, token);
}

// 매일 전체 리포트를 다시 조회·비교하면(과거 것까지 전부 GET 요청 1번씩) 리포트가 쌓일수록
// 60초 제한 안에 못 끝나게 된다(unchanged라도 GitHub에 존재 확인 GET은 매번 나간다 — 코드
// 감사로 발견). 평상시 크론은 최근 것만 보면 충분하니 기본은 최근 구간으로 좁히고, 과거 리포트를
// 통째로 다시 밀어야 할 때만 ?full=1로 명시적으로 넓힌다.
const DEFAULT_DAILY_LOOKBACK_DAYS = 60;
const DEFAULT_PERIOD_LOOKBACK_COUNT = 12;

// DB(dataCompleteness) 감사 흔적은 GitHub 원문(HTTP 상태·JSON)을 그대로 남기지만, Discord 알림은
// 비전공자가 읽으므로 흔한 패턴만 쉬운 한국어 문장으로 바꾼다 — 못 알아본 패턴은 원문 앞부분만
// 잘라서 덧붙인다(완전히 감추지 않음, 필요하면 뒤에서 더 조사 가능하게).
function friendlyDetail(detail: string): string {
  if (/^(GET|PUT) 401/.test(detail)) return "GitHub 접속 열쇠(토큰)가 잘못됐거나 만료됨";
  if (/^(GET|PUT) 403/.test(detail)) return "GitHub 요청이 너무 잦아 잠깐 막힘(사용량 제한) 또는 권한 부족";
  if (/^(GET|PUT) 5\d\d/.test(detail)) return "GitHub 서버 자체에 일시적 문제 발생";
  return `GitHub 연결 문제(${detail.slice(0, 80)})`;
}

// Discord 메시지 2000자 제한 고려 — 실패 목록은 최대 5건만 본문에 담고 나머지는 건수로 요약한다.
function formatErrorAlert(errorDetails: { path: string; detail: string }[]): string {
  const shown = errorDetails.slice(0, 5).map((e) => `- ${e.path}: ${friendlyDetail(e.detail)}`).join("\n");
  const rest = errorDetails.length > 5 ? `\n외 ${errorDetails.length - 5}건 더` : "";
  return `옵시디언 안전망 크론에서 ${errorDetails.length}건 실패:\n${shown}${rest}`;
}

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;
  if (!process.env.GITHUB_EXPORT_TOKEN) {
    const message = "GITHUB_EXPORT_TOKEN 환경변수 없음";
    await sendHealthCheckAlert(`옵시디언 안전망 크론 실행 불가: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const full = new URL(request.url).searchParams.get("full") === "1";

  const results: Record<string, string> = {};
  const errorDetails: { path: string; detail: string }[] = [];

  const dailyRows = await db.dailyReport.findMany({
    orderBy: { date: "asc" },
    ...(full ? {} : { where: { date: { gte: new Date(Date.now() - DEFAULT_DAILY_LOOKBACK_DAYS * 86_400_000) } } }),
  });
  for (const row of dailyRows) {
    const repoPath = `obsidian-export/일일 리포트/${dailyReportFileName(row)}`;
    const { status, detail } = await upsertFile(repoPath, buildDailyReportMarkdown(row));
    results[repoPath] = status;
    if (status === "error") errorDetails.push({ path: repoPath, detail: detail ?? "알 수 없는 오류" });
  }

  const periodRows = await db.periodReport.findMany({
    orderBy: { periodStart: "desc" },
    ...(full ? {} : { take: DEFAULT_PERIOD_LOOKBACK_COUNT }),
  });
  for (const row of periodRows) {
    const repoPath = `obsidian-export/주기별 리포트/${periodReportFileName(row)}`;
    const { status, detail } = await upsertFile(repoPath, buildPeriodReportMarkdown(row));
    results[repoPath] = status;
    if (status === "error") errorDetails.push({ path: repoPath, detail: detail ?? "알 수 없는 오류" });
  }

  const summary = { created: 0, updated: 0, unchanged: 0, error: 0 };
  for (const status of Object.values(results)) summary[status as keyof typeof summary]++;

  if (errorDetails.length > 0) {
    await sendHealthCheckAlert(formatErrorAlert(errorDetails));
  }

  return NextResponse.json({ summary, errors: errorDetails, results });
}
