import { NextResponse } from "next/server";
import { fetchAllFredMetrics } from "@/lib/sources/fred";
import { fetchCftcJpyNetPosition } from "@/lib/sources/cftc";
import { fetchCoinGeckoLatest } from "@/lib/sources/coingecko";
import { fetchJp10yLatest } from "@/lib/sources/mof-japan";
import { fetchAllYahooLatest, fetchAllSectors } from "@/lib/sources/yahoo";
import { fetchKr10y } from "@/lib/sources/ecos";

// 무료 데이터 소스 3종이 실제로 값을 가져오는지 확인하는 진단용 엔드포인트.
// DB에는 저장하지 않는다(순수 연결 확인용). 무인증 배포 시 소스 전체를 대량 호출당할 수 있어
// cron과 같은 가드를 건다.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result: Record<string, unknown> = {};

  // FRED는 API 키가 있어야 동작한다.
  const fredKey = process.env.FRED_API_KEY;
  if (fredKey) {
    try {
      const fred = await fetchAllFredMetrics(fredKey);
      result.fred = { count: fred.points.length, sample: fred.points.slice(-5), errors: fred.errors };
    } catch (err) {
      result.fred = { error: err instanceof Error ? err.message : String(err) };
    }
  } else {
    result.fred = { skipped: "FRED_API_KEY 없음 — https://fred.stlouisfed.org/docs/api/api_key.html 에서 무료 발급" };
  }

  try {
    const cftc = await fetchCftcJpyNetPosition();
    result.cftc = { count: cftc.length, latest: cftc.slice(-1) };
  } catch (err) {
    result.cftc = { error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const coingecko = await fetchCoinGeckoLatest();
    result.coingecko = coingecko;
  } catch (err) {
    result.coingecko = { error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const jp10y = await fetchJp10yLatest();
    result.jp10y_mof = jp10y.slice(-3);
  } catch (err) {
    result.jp10y_mof = { error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const yahoo = await fetchAllYahooLatest();
    result.yahoo = {
      count: yahoo.points.length,
      latestByMetric: Object.fromEntries(
        Object.entries(
          yahoo.points.reduce((acc: Record<string, { date: string; value: number }[]>, p) => {
            (acc[p.metric] ??= []).push({ date: p.date, value: p.value });
            return acc;
          }, {})
        ).map(([k, v]) => [k, v.slice(-1)[0]])
      ),
      errors: yahoo.errors,
    };
  } catch (err) {
    result.yahoo = { error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const sectors = await fetchAllSectors();
    result.sectors = sectors;
  } catch (err) {
    result.sectors = { error: err instanceof Error ? err.message : String(err) };
  }

  const ecosKey = process.env.ECOS_API_KEY;
  if (ecosKey) {
    const from = new Date();
    from.setDate(from.getDate() - 14);
    try {
      const kr10y = await fetchKr10y(ecosKey, from);
      result.kr10y_ecos = kr10y.slice(-3);
    } catch (err) {
      result.kr10y_ecos = { error: err instanceof Error ? err.message : String(err) };
    }
  } else {
    result.kr10y_ecos = { skipped: "ECOS_API_KEY 없음" };
  }

  return Response.json(result);
}
