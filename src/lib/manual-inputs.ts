import { db } from "@/lib/db";

// 자동 소스가 없는 판정들 — v2 프롬프트 원칙대로 억지로 자동화하지 않고 수동 입력으로 남긴다.
// domesticWeightHigh만 "그날의 판단"이 아니라 "바뀌기 전까지 유지되는 설정"이라 최근값을 그대로 쓴다.
const METRIC = {
  NEWS_COUNT_7D: "NEWS_COUNT_7D",
  BIG_EVENT_14D: "BIG_EVENT_14D",
  JPY_VOL_SPIKE: "JPY_VOL_SPIKE",
  FEAR_GREED: "CNN_FEAR_GREED",
  DOMESTIC_WEIGHT_HIGH: "DOMESTIC_WEIGHT_HIGH",
} as const;

export interface ManualInputs {
  newsCountLast7Days: number;
  hasBigEventNext14Days: boolean;
  jpyVolSpike: boolean;
  fearGreed: number | null;
  domesticWeightHigh: boolean;
}

export async function getManualInputsForDate(date: string): Promise<ManualInputs> {
  const d = new Date(date);
  const [news, event, jpy, fg, domestic] = await Promise.all([
    db.manualInputLog.findUnique({ where: { metric_date: { metric: METRIC.NEWS_COUNT_7D, date: d } } }),
    db.manualInputLog.findUnique({ where: { metric_date: { metric: METRIC.BIG_EVENT_14D, date: d } } }),
    db.manualInputLog.findUnique({ where: { metric_date: { metric: METRIC.JPY_VOL_SPIKE, date: d } } }),
    db.manualInputLog.findUnique({ where: { metric_date: { metric: METRIC.FEAR_GREED, date: d } } }),
    db.manualInputLog.findFirst({ where: { metric: METRIC.DOMESTIC_WEIGHT_HIGH }, orderBy: { date: "desc" } }),
  ]);

  return {
    newsCountLast7Days: news?.value ?? 0,
    hasBigEventNext14Days: (event?.value ?? 0) >= 1,
    jpyVolSpike: (jpy?.value ?? 0) >= 1,
    fearGreed: fg?.value ?? null,
    domesticWeightHigh: (domestic?.value ?? 0) >= 1,
  };
}

export async function saveManualInputs(
  date: string,
  input: {
    newsCountLast7Days: number;
    hasBigEventNext14Days: boolean;
    jpyVolSpike: boolean;
    fearGreed: number | null;
    domesticWeightHigh: boolean;
  }
) {
  const d = new Date(date);
  const upsert = (metric: string, value: number) =>
    db.manualInputLog.upsert({
      where: { metric_date: { metric, date: d } },
      create: { metric, date: d, value },
      update: { value },
    });

  const writes = [
    upsert(METRIC.NEWS_COUNT_7D, input.newsCountLast7Days),
    upsert(METRIC.BIG_EVENT_14D, input.hasBigEventNext14Days ? 1 : 0),
    upsert(METRIC.JPY_VOL_SPIKE, input.jpyVolSpike ? 1 : 0),
    upsert(METRIC.DOMESTIC_WEIGHT_HIGH, input.domesticWeightHigh ? 1 : 0),
  ];
  if (input.fearGreed !== null) writes.push(upsert(METRIC.FEAR_GREED, input.fearGreed));
  await Promise.all(writes);
}
