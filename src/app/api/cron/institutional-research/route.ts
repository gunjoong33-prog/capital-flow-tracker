import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { collectAndExportInstitutionalResearch } from "@/lib/institutional-research";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const { saved, errors } = await collectAndExportInstitutionalResearch();
  if (errors.length > 0) {
    await sendHealthCheckAlert(`기관 리서치 수집 중 ${errors.length}건 실패(저장은 ${saved}건 성공):\n${errors.slice(0, 5).join("\n")}`);
  }
  return NextResponse.json({ saved, errors });
}
