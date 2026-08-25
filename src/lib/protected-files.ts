// 자동수정 파이프라인이 절대 못 건드리는 파일 목록 — 코드 상수로 하드코딩한다(설정 파일로 빼면
// LLM이 그 설정값 자체를 우회 수정할 수 있어서). run.ts의 runDailyAnalysis·pipeline.ts의
// runDailyPipeline·pure.ts의 채점 함수들(WEIGHTS·decisionFromScore 포함) — 코드 감사(2026-08-24)와
// 이번 자기학습 설계(2026-08-25) 둘 다 "회귀 위험 커서 손대지 않음"으로 정한 범위와 동일하다.
// 파일 단위로 막는다(pure.ts는 scoreStep1~8 외에 다른 순수함수도 있지만, 이 파일 안에서 어디까지가
// "채점 로직"이고 어디부터 "그 외"인지 자동으로 구분하는 게 더 위험하므로 파일 전체를 보호한다).
export const PROTECTED_FILES: readonly string[] = [
  "src/lib/scoring/run.ts",
  "src/lib/pipeline.ts",
  "src/lib/scoring/pure.ts",
  // pure.ts의 scoreStep1~8은 이 파일의 임계값 상수(NEWS_RISK_INTENSITY_THRESHOLD·VIX_OVERHEAT_BELOW·
  // VIX_FEAR_ABOVE·FEAR_GREED_EXTREME_* 등)를 import해서 쓴다 — types.ts를 안 막으면 채점 로직
  // 자체는 안 건드리고 이 상수만 바꿔서 채점 결과를 바꾸는 우회로가 열린다(최종 리뷰 지적).
  "src/lib/scoring/types.ts",
];

export function touchesProtectedFile(changedFiles: string[]): boolean {
  return changedFiles.some((f) => PROTECTED_FILES.includes(f));
}
