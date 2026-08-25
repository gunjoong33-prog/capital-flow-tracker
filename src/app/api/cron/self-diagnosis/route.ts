import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { runSelfDiagnosis } from "@/lib/self-diagnosis";
import { db } from "@/lib/db";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GITHUB_OWNER = "gunjoong33-prog";
const GITHUB_REPO = "capital-flow-tracker";

async function triggerAutoFixWorkflow(issueDescription: string, logId: string): Promise<void> {
  const token = process.env.GITHUB_EXPORT_TOKEN!;
  await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: "auto-fix-request", client_payload: { issueDescription, logId } }),
  });
}

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  if (process.env.AUTO_FIX_ENABLED === "false") {
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

  await triggerAutoFixWorkflow(issueDescription, log.id);
  return NextResponse.json({ issueDetected: true, autoFixTriggered: true, logId: log.id });
}
