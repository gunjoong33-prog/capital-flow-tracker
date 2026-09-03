import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { synthesizeWeeklyLearning } from "@/lib/learning-synthesis";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

export const dynamic = "force-dynamic";
// LLM 1회 호출이지만 429 재시도(llm-clients.ts)가 그 자체로 최대 60초를 기다릴 수 있어
// 응답까지 포함하면 60초로는 빠듯하다 — learning-distill과 같은 120으로 맞춘다.
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await synthesizeWeeklyLearning();
    return NextResponse.json(result ?? { skipped: true, reason: "이번 주 학습 노트 없음" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendHealthCheckAlert(`주간 학습 요약 생성 실패: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
