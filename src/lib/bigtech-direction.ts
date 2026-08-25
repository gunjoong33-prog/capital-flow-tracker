// 빅테크 등락 원인의 방향성 일치 여부를 판정하는 순수 로직만 모은 파일 — DB(@/lib/db, @/lib/metrics)를
// 전혀 import하지 않는다. bigtech-reasons.ts가 news-events.ts와 같은 이유로 이 파일을 쓴다: 순수
// 판정 로직은 DB 없이도 테스트가 돌아야 해서(news-events.ts 14행, scoring/pure.ts와 동일 패턴).
export function checkDirectionConsistency(
  changePct1d: number | null,
  direction: "up" | "down" | "flat" | undefined
): boolean {
  if (changePct1d === null || direction === undefined || direction === "flat") return true;
  // 0.05%p 이하는 사실상 보합이라 up/down 어느 쪽으로 판정해도 모순으로 볼 실익이 없다.
  if (Math.abs(changePct1d) <= 0.05) return true;
  if (direction === "up" && changePct1d < 0) return false;
  if (direction === "down" && changePct1d > 0) return false;
  return true;
}

// LLM이 판정한 티커별 원인(direction 포함)을 실제 등락률과 대조해, 방향이 모순되면 원문 대신
// 대체 문구로 바꾼다. 대체 문구는 반드시 "명확한 원인 확인 안 됨"(접미사 없이 정확히 이 문자열) —
// run.ts의 정확 일치(exact-match) 비교(topBigTechMover 서술 분기, reasonFor 기본값)가 이 문자열을
// 그대로 기대하기 때문에, 접미사를 붙이면 그 분기가 안 타서 리포트 문장이 자기모순됨.
export function buildConsistentReasons(
  parsed: { ticker: string; reason: string; direction?: "up" | "down" | "flat" }[],
  changes: { ticker: string; changePct1d: number | null }[]
): Record<string, string> {
  const changeByTicker = new Map(changes.map((c) => [c.ticker, c.changePct1d]));
  const result: Record<string, string> = {};
  for (const p of parsed) {
    const consistent = checkDirectionConsistency(changeByTicker.get(p.ticker) ?? null, p.direction);
    result[p.ticker] = consistent ? p.reason : "명확한 원인 확인 안 됨";
  }
  return result;
}
