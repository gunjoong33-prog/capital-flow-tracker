import { NextResponse } from "next/server";
import { syncNewsPageHeadlines } from "@/lib/news-page";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

/**
 * /news 실시간성 보강 크론 — jpy-check/route.ts와 같은 패턴(Vercel Hobby 하루 1회 제한과 무관하게
 * 외부 스케줄러가 원하는 주기로 이 엔드포인트를 호출). 15~30분 간격으로 cron-job.org에 등록해서
 * 쓴다(등록은 이 세션에서 API 키가 없어 코드만 준비 — 사용자가 콘솔에서 등록하거나 키를 주면
 * 다음에 자동 등록 가능).
 *
 * syncNewsPageHeadlines() 자체가 증분(이미 있는 url은 건너뜀)이라 하루 배치(daily 파이프라인)와
 * 이 크론이 같은 함수를 그냥 같이 불러도 안전 — 서로 겹쳐 돌아도 중복 계산·중복 저장 없음.
 */
export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await syncNewsPageHeadlines();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
