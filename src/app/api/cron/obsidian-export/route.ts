import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildDailyReportMarkdown, buildPeriodReportMarkdown, dailyReportFileName, periodReportFileName } from "@/lib/obsidian-export";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GITHUB_OWNER = "gunjoong33-prog";
const GITHUB_REPO = "capital-flow-tracker";
const GITHUB_BRANCH = "master";

/**
 * 옵시디언 vault는 이 PC 로컬 폴더라 Vercel 서버가 직접 못 쓴다 — 대신 이 리포지토리의
 * obsidian-export/ 폴더에 GitHub Contents API로 커밋해두고, 로컬에서는 git pull(가벼움, DB 접속
 * 불필요)로 받아오게 한다. 로컬 vault의 "일일 리포트"·"주기별 리포트" 폴더는 이 폴더를 가리키는
 * Windows 디렉터리 접합(mklink /J)이라, git pull 한 번이면 바로 반영된다.
 *
 * PC가 꺼져 있어도 이 크론(cron-job.org → 이 엔드포인트)은 정시에 돈다 — 그게 이 우회의 핵심 목적.
 * GitHub Actions의 schedule 트리거는 이미 이 프로젝트에서 6~10시간씩 지연되는 게 확인돼서
 * ([[capital_flow_tracker_cron_reliability]] 참고) 안 쓴다.
 */
async function githubRequest(path: string, init?: RequestInit): Promise<Response> {
  const token = process.env.GITHUB_EXPORT_TOKEN;
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

/** 내용이 실제로 바뀐 파일만 커밋한다 — 매일 전체 재생성이라 대부분의 과거 리포트는 그대로인데,
 * 그런 것까지 매번 커밋하면 히스토리가 지저분해지고 API 호출도 낭비된다. */
async function upsertFile(repoPath: string, content: string): Promise<"created" | "updated" | "unchanged" | "error"> {
  const encodedPath = repoPath.split("/").map(encodeURIComponent).join("/");
  const contentBase64 = Buffer.from(content, "utf8").toString("base64");

  const getRes = await githubRequest(`${encodedPath}?ref=${GITHUB_BRANCH}`);
  let sha: string | undefined;
  if (getRes.ok) {
    const existing = (await getRes.json()) as { sha: string; content: string };
    const existingContent = Buffer.from(existing.content, "base64").toString("utf8");
    if (existingContent === content) return "unchanged";
    sha = existing.sha;
  } else if (getRes.status !== 404) {
    return "error";
  }

  const putRes = await githubRequest(encodedPath, {
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

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;
  if (!process.env.GITHUB_EXPORT_TOKEN) {
    return NextResponse.json({ error: "GITHUB_EXPORT_TOKEN 환경변수 없음" }, { status: 500 });
  }

  const results: Record<string, string> = {};
  const errors: string[] = [];

  const dailyRows = await db.dailyReport.findMany({ orderBy: { date: "asc" } });
  for (const row of dailyRows) {
    const repoPath = `obsidian-export/일일 리포트/${dailyReportFileName(row)}`;
    const status = await upsertFile(repoPath, buildDailyReportMarkdown(row));
    results[repoPath] = status;
    if (status === "error") errors.push(repoPath);
  }

  const periodRows = await db.periodReport.findMany({ orderBy: { periodStart: "asc" } });
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
