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

/** LearningNote.summary가 "**볼드**"·"① 지표 근거: ..." 같은 AI 답변 특유의 도식적 구조로
 * 나오는 경우가 실측됐다(learning-distill.ts) — 마크다운 볼드와 번호·라벨 프리픽스를 걷어내고,
 * 문장 하나당 한 줄로 재배열한다(이 사이트의 다른 페이지들과 같은 "한 줄에 한 문장씩" 관례).
 * 프롬프트로 지시해도 모델이 가끔 어기므로(comprehensive-report.ts의 sanitizeFormat과 같은
 * defense-in-depth 원칙) 저장 직전 여기서 기계적으로 한 번 더 정리한다. */
export function toPlainSentenceLines(text: string): string {
  const noBold = text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*\*/g, "");
  // "① **라벨**: " 형태(볼드는 이미 제거됨) — 번호+짧은 라벨+콜론 프리픽스를 통째로 제거.
  const noLabeled = noBold.replace(/[①②③④⑤]\s*[^:：\n]{0,24}[:：]\s*/g, "");
  // 라벨 없이 번호만 붙은 경우("① 이 기관은...") 남은 번호 기호만 제거.
  const noNumbers = noLabeled.replace(/[①②③④⑤]\s*/g, "");

  return noNumbers
    .split(/(?<=[가-힣])\.(?=\s|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith(".") ? s : `${s}.`))
    .join("\n");
}

/** 한글 문장 사이에 영어 단어가 그대로 섞인 경우를 찾는다("although", "unusual한",
 * "조금flows됐지만"처럼) — comprehensive-report.ts·narrative.ts가 프롬프트로 "영어 쓰지
 * 마라"를 아무리 강조해도 mistral-small-latest가 예시로 든 단어만 피하고 새 단어로 계속
 * 어기는 사례가 실측됐다(2026-09 두 차례 재발, "circulating money" 차단 후 "uncertainties"로
 * 재발). 대문자로만 된 토큰(CPI·PPI·FOMC·GDP·VIX·ETF·CEO·AI·BOJ 등 통계·기관 약어와
 * S&P500 같은 지수 표기)은 이 사이트가 원래 허용하는 표기라 제외한다. 자동 번역은 못 하므로
 * (규칙 기반 오번역 위험) 탐지·로그만 한다 — 실제 차단은 프롬프트 규칙과 자가검수 패스가 한다. */
export function findStrayEnglishWords(text: string): string[] {
  const tokens = text.match(/[A-Za-z]{3,}/g) ?? [];
  return [...new Set(tokens.filter((w) => w !== w.toUpperCase()))];
}
