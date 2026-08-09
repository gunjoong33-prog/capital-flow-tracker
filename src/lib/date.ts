// UTC 기준 자정 이후 KST 00~09시 사이에는 "오늘" 날짜 키가 UTC와 KST에서 하루 어긋난다.
// 이 사이트는 노션 표시, 09시 KST 파이프라인, DailyReport 조회/기록이 전부 KST를 기준으로
// "오늘"을 판단해야 하는데, new Date().toISOString().slice(0, 10)은 UTC 기준이라
// KST 00:00~09:00 접속·실행 시 하루 전 날짜로 계산된다(외부 교차검증 지적, 실제 발생 확인).
// 조회·기록 키로 쓰는 모든 "오늘 날짜 문자열"은 이 헬퍼로 통일한다.
export function kstToday(): string {
  return kstDateString(new Date());
}

/** kstToday()의 임의 시각 버전 — asOf를 스레딩하는 곳(run.ts 등)에서 "지금"이 아니라 특정
 * 시점의 KST 날짜가 필요할 때 쓴다. */
export function kstDateString(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}
