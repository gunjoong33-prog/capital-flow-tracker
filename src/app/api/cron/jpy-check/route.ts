import { NextResponse } from "next/server";
import { fetchYahooLatest } from "@/lib/sources/yahoo";
import { saveMetricPoints } from "@/lib/metrics";
import { METRICS } from "@/lib/sources/types";

export const dynamic = "force-dynamic";

/**
 * 엔화 캐리 트레이드 청산은 몇 시간 안에 벌어지는 사건인데, 일일 배치(09시 KST 1회)로는 원리상
 * 못 잡는다는 지적을 반영한 인트라데이 보강 크론. Vercel Hobby 플랜은 크론이 하루 1회로
 * 제한돼 있어(더 잦은 스케줄은 배포 자체가 실패) 여기서는 별도 로직 없이 "오늘 날짜의 USD/JPY
 * 값을 최신 시세로 upsert"만 한다 — MetricValue가 (metric, date) 단위라 하루 안에 여러 번
 * 호출해도 오늘 날짜 한 행이 최신값으로 계속 갱신될 뿐이다. run.ts의 detectJpyVolSpike()는
 * 매 요청마다 실시간으로 이 값을 다시 읽으므로, 이 크론이 하루 중 몇 차례 더 갱신해두면
 * "09시 아침 값에 갇힌 채 하루 종일 안 바뀌는" 문제 없이 장중 변동을 반영한다.
 * 실행은 GitHub Actions 스케줄(.github/workflows/jpy-check.yml)이 담당 — Vercel 네이티브
 * 크론이 아니라 외부에서 이 엔드포인트를 호출하는 방식이라 하루 1회 제한과 무관하다.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const points = await fetchYahooLatest(METRICS.USDJPY);
    await saveMetricPoints(points);
    return NextResponse.json({ saved: points.length, points });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
