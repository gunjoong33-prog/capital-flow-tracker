// 자가진단의 순수 판정 로직 — DB·LLM 호출 없이 verdict 배열만 받아 이상 패턴을 찾는다.
// news-events.ts·scoring/pure.ts와 같은 이유로 DB-free: CI(시크릿 없음)에서 테스트되어야 하고,
// self-diagnosis.ts(오케스트레이션)가 DB에서 읽은 데이터를 여기 넘겨서 판정만 위임한다.

export interface DivergencePattern {
  kind: "low_hit_rate";
  count: number;
  detail: string;
}

// 이전 버전은 "최근 3연속 실패"를 기준으로 삼았는데, 이 사이트는 적중률 50%(동전 던지기)를
// 스스로의 기준선으로 쓰고 있다 — 즉 3연속 실패는 순전히 운이 나빠도 12.5%(0.5^3) 확률로
// 일어난다. 자동수정(AUTO_FIX_ENABLED)이 이 신호로 실제 배포까지 하므로, 우연한 연속 실패를
// "코드 버그"로 오인해 멀쩡한 코드를 건드릴 위험이 컸다(자동배포 활성화 논의 중 지적됨).
// 적중률 페이지(verdict-outcomes.ts의 hitStats)가 이미 쓰는 것과 같은 95% 신뢰구간(Wilson
// score interval) 계산으로 바꿔, "우연이라고 설명하기 어려울 만큼 확실히 저조할 때"만 이상으로
// 본다 — 신뢰구간 상한이 50%보다 낮아야 트리거된다.
const MIN_SAMPLE = 8; // 표본이 이보다 적으면 신뢰구간 자체가 너무 넓어 판단 의미가 없다

function wilsonUpperBound95(hits: number, n: number): number {
  const z = 1.96;
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return Math.min(1, center + half);
}

/** 최근 판정 중 채점 가능한(hit !== null) 것만 모아, 적중률이 50%보다 통계적으로 유의하게
 *  낮은지(95% 신뢰구간 상한 < 50%) 본다. */
export function detectDivergence(verdicts: { date: string; hit: boolean | null }[]): DivergencePattern[] {
  const graded = verdicts.filter((v) => v.hit !== null) as { date: string; hit: boolean }[];
  if (graded.length < MIN_SAMPLE) return [];

  const n = graded.length;
  const hits = graded.filter((v) => v.hit).length;
  const upperBound = wilsonUpperBound95(hits, n);

  if (upperBound >= 0.5) return [];

  const pct = Math.round((hits / n) * 1000) / 10;
  const upperPct = Math.round(upperBound * 1000) / 10;

  return [
    {
      kind: "low_hit_rate",
      count: n,
      detail: `최근 ${n}건 중 ${hits}건 적중(${pct}%) — 95% 신뢰구간 상한이 ${upperPct}%로 동전 던지기(50%)보다 통계적으로 유의하게 낮음(${graded[0].date} ~ ${graded[n - 1].date})`,
    },
  ];
}
