import { NextResponse } from "next/server";
import { runDailyPipeline } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
// Fluid Compute가 켜져 있어 Hobby 플랜에서도 최대 300초까지 가능하다. 파이프라인이 뉴스 판정(Gemini)·
// 지표 10여 개·섹터·기관 시그널을 순차로 불러와 평소에도 55초 안팎이 걸려 기존 60초 한도에 거의
// 붙어 있었다 — 외부 API가 조금만 느려져도(오늘처럼 Gemini 503 재시도 등) 타임아웃으로 크론이
// 리포트를 저장하기 전에 강제 종료돼 그날 리포트가 통째로 누락될 수 있었다.
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDailyPipeline();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
