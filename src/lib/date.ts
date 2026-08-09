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

/** "YYYYMMDD"(구분자 없음) — FINRA·DART·KRX 등 외부 API가 이 포맷을 요구하는 곳에서 공용으로
 * 쓴다(예전엔 파일마다 똑같은 함수를 복붙해서 셋이 따로 존재했다). 호출부가 이미 정오(UTC) 앵커로
 * 만든 Date를 넘기는 걸 전제로 한다 — 그 자체가 KST 경계를 피하려는 의도라 여기서 KST 변환을
 * 다시 하면 안 된다(korea-investment.ts의 fmtDateParam은 반대로 이런 앵커링 없이 raw "지금"을
 * 받는 별개 상황이라 kstDateString을 직접 쓰고 이 함수와는 분리해뒀다). */
export function toYYYYMMDDCompact(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
