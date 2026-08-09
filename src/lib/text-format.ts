// 표·문장 조립 곳곳에서 반복되던 순수 텍스트 포맷터 — run.ts·institutional-signals.ts·
// ReportView.tsx 세 곳에 거의 같은 코드가 복붙돼 있던 걸 하나로 모았다(코드 감사로 발견).

// 표 열 너비가 좁아 줄바꿈이 자주 일어나는데, 일반 공백이면 "0~24 극단적공포"·"티커(회사명)"처럼
// 한 덩어리로 읽혀야 할 구간이 단어 중간에서 끊겨 다음 줄로 넘어가 버린다. 줄바꿈 후보인 공백을
// 줄바꿈 없는 공백(NBSP)으로 바꿔서 이 단위가 항상 붙어 다니게 한다.
export function nbsp(s: string): string {
  return s.replace(/ /g, " ");
}

/** "YYYY-MM-DD" → "YYYY/M/D"(선행 0 없이). 1단계 등 날짜 표시를 "/" 구분으로 통일. */
export function slashDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}/${m}/${d}`;
}

/** LLM이 플레이스홀더 치환 뒤 자기 마침표를 하나 더 붙여 "...습니다.."처럼 마침표가 중복되는
 * 경우가 있다 — comprehensive-report.ts·period-report.ts 둘 다 생성 마지막 단계에서 이 정리를
 * 똑같이 하고 있던 걸 하나로 모았다(코드 감사로 발견). */
export function collapseRepeatedDots(text: string): string {
  return text.replace(/\.\.+/g, ".");
}
