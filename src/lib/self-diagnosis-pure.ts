// 자가진단의 순수 판정 로직 — DB·LLM 호출 없이 verdict 배열만 받아 이상 패턴을 찾는다.
// news-events.ts·scoring/pure.ts와 같은 이유로 DB-free: CI(시크릿 없음)에서 테스트되어야 하고,
// self-diagnosis.ts(오케스트레이션)가 DB에서 읽은 데이터를 여기 넘겨서 판정만 위임한다.

export interface DivergencePattern {
  kind: "consecutive_miss";
  count: number;
  detail: string;
}

const MIN_SAMPLE = 3; // 이보다 적은 표본으로 "패턴"을 주장하면 우연을 규칙으로 오인하는 과최적화 위험

/** 최근 판정 중 채점 가능한(hit !== null) 것만 최신순으로 보고, 연속 실패 구간을 찾는다. */
export function detectDivergence(verdicts: { date: string; hit: boolean | null }[]): DivergencePattern[] {
  const graded = verdicts.filter((v) => v.hit !== null) as { date: string; hit: boolean }[];
  if (graded.length < MIN_SAMPLE) return [];

  let consecutiveMiss = 0;
  for (let i = graded.length - 1; i >= 0; i--) {
    if (graded[i].hit === false) consecutiveMiss++;
    else break;
  }

  // 연속 불일치가 표본 전체를 차지해야만 패턴으로 본다(중간에 적중이 섞여 있으면 안 됨)
  if (consecutiveMiss < MIN_SAMPLE || consecutiveMiss !== graded.length) return [];

  return [
    {
      kind: "consecutive_miss",
      count: consecutiveMiss,
      detail: `최근 판정 ${consecutiveMiss}건이 연속으로 실제 가격 변화와 어긋남(${graded[graded.length - consecutiveMiss].date} ~ ${graded[graded.length - 1].date})`,
    },
  ];
}
