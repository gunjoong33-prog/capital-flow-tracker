import { db } from "@/lib/db";

// 뉴스 판정·주요 이벤트 일정·엔화 변동성 급등은 이제 자동 계산된다(news-events.ts, major-events.ts,
// scoring/run.ts의 detectJpyVolSpike). CNN 공포탐욕지수는 공식 API가 없어 여전히 수동 입력이고,
// domesticWeightHigh는 "그날의 판단"이 아니라 "바뀌기 전까지 유지되는 설정"이라 최근값을 그대로 쓴다.
const METRIC = {
  FEAR_GREED: "CNN_FEAR_GREED",
  DOMESTIC_WEIGHT_HIGH: "DOMESTIC_WEIGHT_HIGH",
} as const;

export interface ManualInputs {
  fearGreed: number | null;
  domesticWeightHigh: boolean;
}

export async function getManualInputsForDate(date: string): Promise<ManualInputs> {
  const d = new Date(date);
  const [fg, domestic] = await Promise.all([
    db.manualInputLog.findUnique({ where: { metric_date: { metric: METRIC.FEAR_GREED, date: d } } }),
    db.manualInputLog.findFirst({ where: { metric: METRIC.DOMESTIC_WEIGHT_HIGH }, orderBy: { date: "desc" } }),
  ]);

  return {
    fearGreed: fg?.value ?? null,
    domesticWeightHigh: (domestic?.value ?? 0) >= 1,
  };
}

export async function saveManualInputs(
  date: string,
  input: { fearGreed: number | null; domesticWeightHigh: boolean }
) {
  const d = new Date(date);
  const upsert = (metric: string, value: number) =>
    db.manualInputLog.upsert({
      where: { metric_date: { metric, date: d } },
      create: { metric, date: d, value },
      update: { value },
    });

  const writes = [upsert(METRIC.DOMESTIC_WEIGHT_HIGH, input.domesticWeightHigh ? 1 : 0)];
  if (input.fearGreed !== null) writes.push(upsert(METRIC.FEAR_GREED, input.fearGreed));
  await Promise.all(writes);
}
