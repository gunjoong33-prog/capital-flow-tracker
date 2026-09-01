import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { distillAndSaveLearningNotes } from "@/lib/learning-distill";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

export const dynamic = "force-dynamic";
// institutional-research.ts 확장(2026-09-01)으로 distill 대상 sourceName 그룹이 20개+로
// 늘었다 — 3개씩 배치 병렬 처리(learning-distill.ts)로도 60초는 빠듯해 넉넉히 올린다.
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const { saved, errors } = await distillAndSaveLearningNotes();
  if (errors.length > 0) {
    await sendHealthCheckAlert(`학습노트 distill 중 ${errors.length}건 실패(저장은 ${saved}건 성공):\n${errors.slice(0, 5).join("\n")}`);
  }
  return NextResponse.json({ saved, errors });
}
