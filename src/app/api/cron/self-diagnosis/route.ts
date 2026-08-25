import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { runSelfDiagnosis } from "@/lib/self-diagnosis";
import { db } from "@/lib/db";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GITHUB_OWNER = "gunjoong33-prog";
const GITHUB_REPO = "capital-flow-tracker";

async function triggerAutoFixWorkflow(issueDescription: string, logId: string): Promise<boolean> {
  const token = process.env.GITHUB_EXPORT_TOKEN!;
  const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: "auto-fix-request", client_payload: { issueDescription, logId } }),
  });
  if (!response.ok) {
    await sendHealthCheckAlert(`자가진단 이상 발견했지만 GitHub 자동수정 트리거 요청 실패(HTTP ${response.status}): ${issueDescription}`);
  }
  return response.ok;
}

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  // 킬스위치는 fail-closed다 — AUTO_FIX_ENABLED가 정확히 "true"일 때만 자동수정을 켠다.
  // 미설정·빈 문자열·오타는 전부 비활성(fail-open이었던 이전 버전은 unset이면 자동으로 켜지는
  // 버그였다 — master에 쓰기 권한이 있는 무인 파이프라인은 반드시 명시적 opt-in이어야 한다).
  if (process.env.AUTO_FIX_ENABLED !== "true") {
    const { issueDetected, issueDescription } = await runSelfDiagnosis();
    if (issueDetected) await sendHealthCheckAlert(`자가진단 이상 발견(킬스위치로 자동수정 비활성 — 사람이 확인 필요): ${issueDescription}`);
    return NextResponse.json({ issueDetected, autoFixTriggered: false });
  }

  const { issueDetected, issueDescription } = await runSelfDiagnosis();
  if (!issueDetected || !issueDescription) return NextResponse.json({ issueDetected: false, autoFixTriggered: false });

  const log = await db.autoFixLog.create({ data: { detectedIssue: issueDescription } });
  if (!process.env.GITHUB_EXPORT_TOKEN) {
    await sendHealthCheckAlert(`자가진단 이상 발견했지만 GITHUB_EXPORT_TOKEN 없어 자동수정 트리거 불가: ${issueDescription}`);
    return NextResponse.json({ issueDetected: true, autoFixTriggered: false });
  }

  const triggered = await triggerAutoFixWorkflow(issueDescription, log.id);
  return NextResponse.json({ issueDetected: true, autoFixTriggered: triggered, logId: log.id });
}
