// 1년치 히스토리 백필 — 콜드스타트 문제(3·5·8단계 "최근 1년 백분위" 계산에 과거 데이터 필요) 해소.
// 실행: npx tsx scripts/backfill.ts
import "dotenv/config";
import { db } from "../src/lib/db";
import { fetchAllFredMetrics } from "../src/lib/sources/fred";
import { fetchCftcJpyNetPosition } from "../src/lib/sources/cftc";
import { fetchCoinGeckoRange } from "../src/lib/sources/coingecko";
import { fetchJp10yHistorical } from "../src/lib/sources/mof-japan";
import { fetchYahooHistorical } from "../src/lib/sources/yahoo";
import { fetchKr10y, fetchBokBaseRate } from "../src/lib/sources/ecos";
import { METRICS, type FetchedPoint } from "../src/lib/sources/types";

const oneYearAgo = new Date();
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
const startDateStr = oneYearAgo.toISOString().slice(0, 10);

async function save(points: FetchedPoint[], label: string) {
  let saved = 0;
  for (const p of points) {
    if (Number.isNaN(p.value)) continue;
    await db.metricValue.upsert({
      where: { metric_date: { metric: p.metric, date: new Date(p.date) } },
      create: { metric: p.metric, date: new Date(p.date), value: p.value, source: p.source },
      update: { value: p.value, source: p.source },
    });
    saved++;
  }
  console.log(`✅ ${label}: ${saved}건 저장`);
}

async function main() {
  console.log(`백필 시작 — 기준일 ${startDateStr}부터\n`);

  // FRED (WALCL, M2, TOTRESNS, RRP, TGA, 실질금리, 크레딧스프레드, US10Y, 2Y-10Y스프레드)
  const fredKey = process.env.FRED_API_KEY;
  if (fredKey) {
    const fred = await fetchAllFredMetrics(fredKey, startDateStr);
    await save(fred.points, "FRED (9개 지표)");
    if (fred.errors.length) console.log("  FRED 오류:", fred.errors);
  } else {
    console.log("⏭️  FRED_API_KEY 없음, 스킵");
  }

  // CFTC 엔화 순포지션
  try {
    const cftc = await fetchCftcJpyNetPosition(startDateStr);
    await save(cftc, "CFTC 엔화 순포지션");
  } catch (err) {
    console.log("❌ CFTC 실패:", err instanceof Error ? err.message : err);
  }

  // CoinGecko BTC, ETH
  try {
    const btc = await fetchCoinGeckoRange(METRICS.BTC, oneYearAgo);
    await save(btc, "BTC");
    const eth = await fetchCoinGeckoRange(METRICS.ETH, oneYearAgo);
    await save(eth, "ETH");
  } catch (err) {
    console.log("❌ CoinGecko 실패:", err instanceof Error ? err.message : err);
  }

  // 일본 JGB 10년물
  try {
    const jp10y = await fetchJp10yHistorical();
    const filtered = jp10y.filter((p) => p.date >= startDateStr);
    await save(filtered, "JP10Y (일본재무성)");
  } catch (err) {
    console.log("❌ MOF 실패:", err instanceof Error ? err.message : err);
  }

  // Yahoo Finance (금, 유가, 환율, 지수, VIX)
  const yahooMetrics = [
    METRICS.GOLD, METRICS.WTI, METRICS.BRENT, METRICS.USDKRW, METRICS.USDJPY,
    METRICS.NDX, METRICS.RUT, METRICS.DJI, METRICS.SPX, METRICS.VIX,
    METRICS.AAPL, METRICS.MSFT, METRICS.GOOGL, METRICS.AMZN, METRICS.NVDA, METRICS.META, METRICS.TSLA,
  ];
  for (const metric of yahooMetrics) {
    try {
      const points = await fetchYahooHistorical(metric);
      await save(points, `Yahoo: ${metric}`);
    } catch (err) {
      console.log(`❌ Yahoo ${metric} 실패:`, err instanceof Error ? err.message : err);
    }
  }

  // ECOS (한국 10년 국채, 기준금리)
  const ecosKey = process.env.ECOS_API_KEY;
  if (ecosKey) {
    try {
      const kr10y = await fetchKr10y(ecosKey, oneYearAgo);
      await save(kr10y, "KR10Y (한국은행)");
    } catch (err) {
      console.log("❌ ECOS KR10Y 실패:", err instanceof Error ? err.message : err);
    }
    try {
      const bokRate = await fetchBokBaseRate(ecosKey, oneYearAgo);
      await save(bokRate, "BOK 기준금리");
    } catch (err) {
      console.log("❌ ECOS 기준금리 실패:", err instanceof Error ? err.message : err);
    }
  } else {
    console.log("⏭️  ECOS_API_KEY 없음, 스킵");
  }

  // 파생 지표: 나스닥-러셀 20거래일 누적수익률 격차(5단계 백분위 계산용)
  await computeNdxRutGapSeries();

  console.log("\n백필 완료");
  await db.$disconnect();
}

async function computeNdxRutGapSeries() {
  const ndx = await db.metricValue.findMany({ where: { metric: METRICS.NDX }, orderBy: { date: "asc" } });
  const rut = await db.metricValue.findMany({ where: { metric: METRICS.RUT }, orderBy: { date: "asc" } });
  const rutByDate = new Map(rut.map((r) => [r.date.toISOString().slice(0, 10), r.value]));

  let saved = 0;
  for (let i = 20; i < ndx.length; i++) {
    const today = ndx[i];
    const past = ndx[i - 20];
    const ndxReturn = ((today.value - past.value) / past.value) * 100;

    const todayDate = today.date.toISOString().slice(0, 10);
    const rutToday = rutByDate.get(todayDate);
    const rutPastEntry = rut.find((r) => r.date.getTime() === past.date.getTime());
    if (rutToday === undefined || !rutPastEntry) continue;
    const rutReturn = ((rutToday - rutPastEntry.value) / rutPastEntry.value) * 100;

    const gap = ndxReturn - rutReturn;
    await db.metricValue.upsert({
      where: { metric_date: { metric: "NDX_RUT_GAP", date: today.date } },
      create: { metric: "NDX_RUT_GAP", date: today.date, value: gap, source: "manual" },
      update: { value: gap },
    });
    saved++;
  }
  console.log(`✅ NDX_RUT_GAP (파생, 5단계 백분위용): ${saved}건 저장`);
}

main().catch((err) => {
  console.error("백필 실패:", err);
  process.exit(1);
});
