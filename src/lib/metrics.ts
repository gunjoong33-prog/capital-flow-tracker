import { db } from "@/lib/db";
import type { FetchedPoint } from "@/lib/sources/types";

/** 지표 시계열 포인트들을 DB에 upsert. 같은 (metric, date)는 덮어쓴다. */
export async function saveMetricPoints(points: FetchedPoint[]) {
  let saved = 0;
  for (const p of points) {
    await db.metricValue.upsert({
      where: { metric_date: { metric: p.metric, date: new Date(p.date) } },
      create: {
        metric: p.metric,
        date: new Date(p.date),
        value: p.value,
        source: p.source,
        isManual: p.source === "manual",
      },
      update: {
        value: p.value,
        source: p.source,
        isManual: p.source === "manual",
      },
    });
    saved++;
  }
  return saved;
}

/** 특정 지표의 최신값 조회. */
export async function getLatestMetric(metric: string) {
  return db.metricValue.findFirst({
    where: { metric },
    orderBy: { date: "desc" },
  });
}

/** 특정 지표의 최근 N일치 조회(백분위·구간 계산용). */
export async function getMetricHistory(metric: string, days: number) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return db.metricValue.findMany({
    where: { metric, date: { gte: since } },
    orderBy: { date: "asc" },
  });
}

/**
 * 특정 지표의 최근 N개 "데이터포인트"를 달력 일수와 무관하게 그대로 가져온다.
 * 월간 지표(TOTRESNS, REAL_RATE 등)는 발표가 몇 달씩 밀리기도 해서 getMetricHistory의
 * 날짜창 방식으로는 필요한 개수를 못 채우는 경우가 있다 — "최근 N일"이 아니라 "최근 N개"가
 * 필요한 연속 증가/감소 판정에는 이 함수를 쓴다.
 */
export async function getMetricHistoryByCount(metric: string, count: number) {
  const rows = await db.metricValue.findMany({
    where: { metric },
    orderBy: { date: "desc" },
    take: count,
  });
  return rows.reverse();
}

/**
 * 값의 최근 1년 내 백분위(0~100) 계산.
 * 3단계(캐리 스프레드·포지션), 5단계(나스닥-러셀 격차) 백분위 산출에 공용으로 씀.
 */
export async function calculatePercentile(
  metric: string,
  currentValue: number
): Promise<number | null> {
  const history = await getMetricHistory(metric, 365);
  if (history.length < 30) return null; // 콜드스타트: 데이터 부족하면 계산 안 함
  const values = history.map((h) => h.value).sort((a, b) => a - b);
  const belowCount = values.filter((v) => v <= currentValue).length;
  return Math.round((belowCount / values.length) * 100);
}

/** N거래일 누적 수익률(%) — 5단계 나스닥/러셀/BTC 등. */
export async function calculateCumulativeReturn(
  metric: string,
  tradingDays: number
): Promise<number | null> {
  const history = await db.metricValue.findMany({
    where: { metric },
    orderBy: { date: "desc" },
    take: tradingDays + 1,
  });
  if (history.length < tradingDays + 1) return null;
  const latest = history[0].value;
  const past = history[history.length - 1].value;
  return ((latest - past) / past) * 100;
}
