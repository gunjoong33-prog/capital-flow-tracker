import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { synthesizeWeeklyLearning } from "@/lib/learning-synthesis";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

export const dynamic = "force-dynamic";
// LLM 1회 호출뿐이라(학습노트 20+건을 순차 distill하는 learning-distill과 다름) 기본 60초로
// 충분하다.
export const maxDuration = 60;

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
