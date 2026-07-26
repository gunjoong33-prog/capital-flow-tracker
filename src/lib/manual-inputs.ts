import { db } from "@/lib/db";

// 뉴스 판정·주요 이벤트 일정·엔화 변동성 급등은 이제 자동 계산된다(news-events.ts, major-events.ts,
// scoring/run.ts의 detectJpyVolSpike). CNN 공포탐욕지수는 공식 API가 없어 여전히 수동 입력이다.
const METRIC = {
  FEAR_GREED: "CNN_FEAR_GREED",
} as const;

export interface ManualInputs {
  fearGreed: number | null;
}

export async function getManualInputsForDate(date: string): Promise<ManualInputs> {
  const d = new Date(date);
  const fg = await db.manualInputLog.findUnique({ where: { metric_date: { metric: METRIC.FEAR_GREED, date: d } } });

  return {
    fearGreed: fg?.value ?? null,
  };
}

export async function saveManualInputs(date: string, input: { fearGreed: number | null }) {
  const d = new Date(date);
  if (input.fearGreed === null) return;
  await db.manualInputLog.upsert({
    where: { metric_date: { metric: METRIC.FEAR_GREED, date: d } },
    create: { metric: METRIC.FEAR_GREED, date: d, value: input.fearGreed },
    update: { value: input.fearGreed },
  });
}
