import { NextResponse } from "next/server";
import { fetchYahooLatest } from "@/lib/sources/yahoo";
import { saveMetricPoints } from "@/lib/metrics";
import { METRICS } from "@/lib/sources/types";

export const dynamic = "force-dynamic";

/**
 * 엔화 캐리 트레이드 청산은 몇 시간 안에 벌어지는 사건인데, 일일 배치(09시 KST 1회)로는 원리상
 * 못 잡는다는 지적을 반영한 인트라데이 보강 크론. Vercel Hobby 플랜은 크론이 하루 1회로
 * 제한돼 있어(더 잦은 스케줄은 배포 자체가 실패) 여기서는 별도 로직 없이 "오늘 날짜의 USD/JPY
 * 값을 최신 시세로 upsert"만 한다.
 *
 * 반드시 METRICS.USDJPY_INTRADAY에만 쓴다 — 확정 종가 시계열(METRICS.USDJPY)에 쓰면 안 된다.
 * 예전엔 이 크론이 USDJPY 행을 직접 덮어써서, 하루 중 몇 차례씩 값이 바뀌는 바람에 "전일 종가"라는
 * 기준점 자체가 사라지고 detectJpyVolSpike()의 z-score 계산(같은 시계열의 종가 대 종가 변동률)도
 * 같이 무력화됐다(외부 감사 지적, 실제 확인 — 큰 움직임일수록 여러 번의 덮어쓰기에 잘게 쪼개져
 * 흡수되고, 움직임이 클수록 더 잘 숨겨지는 구조였다). run.ts는 인트라데이 경보를 낼 때
 * (USDJPY_INTRADAY 최신값 - 마지막 확정 USDJPY 종가) 기준으로 별도 계산한다.
 * 실행은 GitHub Actions 스케줄(.github/workflows/jpy-intraday-check.yml)이 담당 — Vercel 네이티브
 * 크론이 아니라 외부에서 이 엔드포인트를 호출하는 방식이라 하루 1회 제한과 무관하다.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const points = await fetchYahooLatest(METRICS.USDJPY_INTRADAY);
    await saveMetricPoints(points);
    return NextResponse.json({ saved: points.length, points });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
