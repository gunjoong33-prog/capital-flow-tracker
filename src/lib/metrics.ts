import { db } from "@/lib/db";
import type { FetchedPoint } from "@/lib/sources/types";

/**
 * 지표 시계열 포인트들을 DB에 upsert. 같은 (metric, date)는 덮어쓴다.
 * 포인트당 순차 왕복이면 하루 90여 회가 그대로 누적된다(외부 감사 지적, 실제 확인) — 청크 단위로
 * 병렬화한다. 전체를 한 번에 Promise.all로 몰면 대량 백필(수천~수만 건) 시 Neon 커넥션 풀이
 * 고갈돼 끊기는 걸 실제로 겪었으므로(이전 세션의 FRED 5년 백필 크래시), 청크 크기를 적당히
 * 제한해 동시 커넥션 수를 억제한다.
 */
const UPSERT_CHUNK_SIZE = 10;

export async function saveMetricPoints(points: FetchedPoint[]) {
  let saved = 0;
  for (let i = 0; i < points.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = points.slice(i, i + UPSERT_CHUNK_SIZE);
    await Promise.all(
      chunk.map((p) =>
        db.metricValue.upsert({
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
        })
      )
    );
    saved += chunk.length;
  }
  return saved;
}

// 아래 6개 함수 전부 asOf 매개변수를 받는다(기본값 new Date() — 안 넘기면 기존과 동작 완전히
// 동일). 과거 특정 날짜(예: 7/28) 기준으로 2~8단계 점수를 정확히 재구성하려면 "최신값"이 아니라
// "그 날짜 시점 최신값"을 조회해야 하는데, 기존엔 전부 orderBy date desc만 쓰고 상한을 안 둬서
// 항상 DB에서 제일 최근 값(=오늘)을 가져왔다 — 과거 날짜 재계산에 오늘 데이터가 섞여 들어가는
// 문제가 있었다. date lte asOf로 상한을 걸어 해결한다.

/** 특정 지표의 최신값 조회(asOf 시점 기준). */
export async function getLatestMetric(metric: string, asOf: Date = new Date()) {
  return db.metricValue.findFirst({
    where: { metric, date: { lte: asOf } },
    orderBy: { date: "desc" },
  });
}

/** 특정 지표의 asOf 기준 최근 N일치 조회(백분위·구간 계산용). */
export async function getMetricHistory(metric: string, days: number, asOf: Date = new Date()) {
  const since = new Date(asOf);
  since.setDate(since.getDate() - days);
  return db.metricValue.findMany({
    where: { metric, date: { gte: since, lte: asOf } },
    orderBy: { date: "asc" },
  });
}

/**
 * 특정 지표의 asOf 기준 최근 N개 "데이터포인트"를 달력 일수와 무관하게 그대로 가져온다.
 * 월간 지표(TOTRESNS, REAL_RATE 등)는 발표가 몇 달씩 밀리기도 해서 getMetricHistory의
 * 날짜창 방식으로는 필요한 개수를 못 채우는 경우가 있다 — "최근 N일"이 아니라 "최근 N개"가
 * 필요한 연속 증가/감소 판정에는 이 함수를 쓴다.
 */
export async function getMetricHistoryByCount(metric: string, count: number, asOf: Date = new Date()) {
  const rows = await db.metricValue.findMany({
    where: { metric, date: { lte: asOf } },
    orderBy: { date: "desc" },
    take: count,
  });
  return rows.reverse();
}

/**
 * 값의 asOf 기준 최근 1년 내 백분위(0~100) 계산.
 * 3단계(캐리 스프레드·포지션), 5단계(나스닥-러셀 격차) 백분위 산출에 공용으로 씀.
 */
export async function calculatePercentile(
  metric: string,
  currentValue: number,
  asOf: Date = new Date()
): Promise<number | null> {
  const history = await getMetricHistory(metric, 365, asOf);
  if (history.length < 30) return null; // 콜드스타트: 데이터 부족하면 계산 안 함
  const values = history.map((h) => h.value).sort((a, b) => a - b);
  const belowCount = values.filter((v) => v <= currentValue).length;
  return Math.round((belowCount / values.length) * 100);
}

/**
 * calculatePercentile과 같지만 "최근 365일" 날짜창 대신 "최근 N개 데이터포인트"를 쓴다.
 * REAL_RATE 같은 월간 지표는 365일 창에 12~13개월치밖에 안 잡혀 표본 30개 기준을 영원히
 * 못 채운다(risingCheck/fallingCheck가 월간 지표 때문에 날짜창 대신 개수 기준으로 바꾼 것과
 * 같은 이유 — getMetricHistoryByCount 참고).
 */
export async function calculatePercentileByCount(
  metric: string,
  currentValue: number,
  count: number,
  asOf: Date = new Date()
): Promise<number | null> {
  const history = await getMetricHistoryByCount(metric, count, asOf);
  if (history.length < 30) return null;
  const values = history.map((h) => h.value).sort((a, b) => a - b);
  const belowCount = values.filter((v) => v <= currentValue).length;
  return Math.round((belowCount / values.length) * 100);
}

/** N거래일 누적 수익률(%) — 5단계 나스닥/러셀/BTC 등(asOf 시점 기준). */
export async function calculateCumulativeReturn(
  metric: string,
  tradingDays: number,
  asOf: Date = new Date()
): Promise<number | null> {
  const history = await db.metricValue.findMany({
    where: { metric, date: { lte: asOf } },
    orderBy: { date: "desc" },
    take: tradingDays + 1,
  });
  if (history.length < tradingDays + 1) return null;
  const latest = history[0].value;
  const past = history[history.length - 1].value;
  return ((latest - past) / past) * 100;
}
