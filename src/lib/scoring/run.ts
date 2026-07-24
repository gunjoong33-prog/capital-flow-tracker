import { getLatestMetric, getMetricHistory, calculatePercentile, calculateCumulativeReturn } from "@/lib/metrics";
import { METRICS, SECTOR_ETFS } from "@/lib/sources/types";
import {
  scoreStep1,
  scoreStep2,
  scoreStep3,
  scoreStep4,
  scoreStep5,
  scoreStep6,
  scoreStep7,
  scoreStep8,
} from "./pure";
import type { Direction, SectorInput } from "./types";

/** 최근 값들이 계속 늘고/줄고 있는지 판정. 데이터 부족하면 null(모름). */
async function isRisingFor(metric: string, periods: number): Promise<boolean | null> {
  const history = await getMetricHistory(metric, periods * 10); // 여유 있게 가져와서 최근 N개만 씀
  if (history.length < periods + 1) return null;
  const recent = history.slice(-(periods + 1));
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].value <= recent[i - 1].value) return false;
  }
  return true;
}

async function isFallingFor(metric: string, periods: number): Promise<boolean | null> {
  const history = await getMetricHistory(metric, periods * 10);
  if (history.length < periods + 1) return null;
  const recent = history.slice(-(periods + 1));
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].value >= recent[i - 1].value) return false;
  }
  return true;
}

async function directionOf(metric: string): Promise<Direction | null> {
  const history = await getMetricHistory(metric, 10);
  if (history.length < 2) return null;
  const [prev, curr] = history.slice(-2);
  if (curr.value > prev.value) return "up";
  if (curr.value < prev.value) return "down";
  return "flat";
}

/**
 * 오늘자 v2 체크리스트 전체를 DB 데이터로 계산한다.
 * 지표가 없으면 해당 판정은 null(모름)로 남기고 억지로 채우지 않는다 —
 * 원칙: "확인 못하면 확인 못함이라고 쓴다"(v2 프롬프트 핵심 원칙).
 *
 * 수동 입력 지표(CNN F&G, 비트코인 ETF 자금흐름)와 finviz 대체 지표(섹터 5일 수익률)는
 * 별도 인자로 주입받는다 — 자동 수집원이 없기 때문(지난 감사 리스크1 참고).
 */
export async function runDailyAnalysis(manualInputs: {
  newsCountLast7Days: number;
  hasBigEventNext14Days: boolean;
  domesticWeightHigh: boolean;
  jpyVolSpike: boolean;
  fearGreed: number | null;
  sectors: SectorInput[];
}) {
  // 1단계
  const step1 = scoreStep1({
    newsCountLast7Days: manualInputs.newsCountLast7Days,
    hasBigEventNext14Days: manualInputs.hasBigEventNext14Days,
  });

  // 2단계
  const step2 = scoreStep2({
    walclIncreasing: await isRisingFor(METRICS.WALCL, 2),
    m2GrowthRising2Months: await isRisingFor(METRICS.M2, 2),
    reservesRising4Weeks: await isRisingFor(METRICS.TOTRESNS, 4),
    rrpDeclining: await isFallingFor(METRICS.RRP, 3),
    tgaDeclining: await isFallingFor(METRICS.TGA, 3),
    realRateFallingOrLowFlat: await isFallingFor(METRICS.REAL_RATE, 3),
    creditSpreadNarrowing: await isFallingFor(METRICS.CREDIT_SPREAD, 3),
    domesticWeightHigh: manualInputs.domesticWeightHigh,
    bokRateEasing: null, // 한국은행 기준금리는 비정기 발표 — 별도 로직 필요, 1차 구현에선 미판정
    cpiNearTarget: null,
    kospiForeignNetBuying: await isRisingFor(METRICS.KOSPI_FOREIGN_NET, 5),
  });

  // 3단계
  const us10y = await getLatestMetric(METRICS.US10Y);
  const jp10y = await getLatestMetric(METRICS.JP10Y);
  const spreadPercentile = us10y && jp10y
    ? await calculatePercentile(METRICS.US10Y_2Y10Y_SPREAD, (us10y.value - jp10y.value) * 100)
    : null;
  const cftcPercentile = await (async () => {
    const latest = await getLatestMetric(METRICS.CFTC_JPY_NET);
    if (!latest) return null;
    return calculatePercentile(METRICS.CFTC_JPY_NET, latest.value);
  })();
  const step3 = scoreStep3({
    us10y: us10y?.value ?? 0,
    jp10y: jp10y?.value ?? 0,
    spreadBpPercentile: spreadPercentile,
    cftcNetPositionPercentile: cftcPercentile,
    jpyVolSpike: manualInputs.jpyVolSpike,
  });

  // 4단계
  const step4 = scoreStep4({
    goldDirection: (await directionOf(METRICS.GOLD)) ?? "flat",
    realRateDirection: (await directionOf(METRICS.REAL_RATE)) ?? "flat",
    dollarDirection: (await directionOf(METRICS.USDKRW)) ?? "flat",
  });

  // 5단계
  const ndxReturn20d = (await calculateCumulativeReturn(METRICS.NDX, 20)) ?? 0;
  const rutReturn20d = (await calculateCumulativeReturn(METRICS.RUT, 20)) ?? 0;
  const gapPercentile = await calculatePercentile(
    "NDX_RUT_GAP", // 파생 지표 — 백필 스크립트에서 별도로 저장해야 함(8단계 구현 시 참고)
    ndxReturn20d - rutReturn20d
  );
  const step5 = scoreStep5({
    ndxReturn20d,
    rutReturn20d,
    gapPercentile,
    djiReturn20d: (await calculateCumulativeReturn(METRICS.DJI, 20)) ?? 0,
    spxReturn20d: (await calculateCumulativeReturn(METRICS.SPX, 20)) ?? 0,
    btcReturn20d: await calculateCumulativeReturn(METRICS.BTC, 20),
    ethReturn20d: await calculateCumulativeReturn(METRICS.ETH, 20),
  });

  // 6단계
  const step6 = scoreStep6({ sectors: manualInputs.sectors });

  // 7단계
  const vix = await getLatestMetric(METRICS.VIX);
  const step7 = scoreStep7({ vix: vix?.value ?? null, fearGreed: manualInputs.fearGreed });

  // 8단계
  const step8 = scoreStep8({ step1, step2, step3, step4, step5, step6, step7 });

  return { step1, step2, step3, step4, step5, step6, step7, step8 };
}

// 참고: SECTOR_ETFS는 6단계 수동 입력을 만들 때 어떤 티커를 조회해야 하는지 알려주는 상수.
// EODHD 연동(6번 과제) 완료 전까지는 sectors 배열을 호출부에서 직접 채워 넣어야 한다.
export { SECTOR_ETFS };
