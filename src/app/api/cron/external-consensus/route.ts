import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { collectExternalConsensus } from "@/lib/external-consensus";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 국내 컨센서스·Finnhub는 종목별로 조회하므로 5단계(자금도착)가 이미 추적하는 빅테크 7 + 지수
// ETF만 우선 추적한다 — 전 종목을 매주 스크래핑하면 느리고 이 기능의 목적(방향성 대조)에도 과함.
const TRACKED_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"];

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const { saved, errors } = await collectExternalConsensus(TRACKED_TICKERS);
  if (errors.length > 0) {
    await sendHealthCheckAlert(`외부 컨센서스 수집 중 ${errors.length}건 실패(저장은 ${saved}건 성공):\n${errors.slice(0, 5).join("\n")}`);
  }
  return NextResponse.json({ saved, errors });
}
