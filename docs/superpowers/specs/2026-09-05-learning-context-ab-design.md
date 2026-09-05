# 학습 요약 반영도 A/B 비교 — 설계 문서

**배경**: `/correction-process/self-learning` 페이지의 "부족한 점 · 필요한 점" 3번 — `generateNarrative()`가 매 호출마다 예외 없이 그 주 학습 요약(`fetchRecentLearningContext()`)을 프롬프트에 붙인다는 것은 코드로 확인했지만, LLM이 그 참고자료를 실제로 얼마나 반영해 문장을 바꾸는지는 측정하지 않고 있었다.

## 목표

매일 종합보고서를 학습 요약 포함/미포함 두 버전으로 생성해 나란히 저장하고, self-learning 페이지에서 사람이 직접 두 글을 비교해 "실제로 달라지는지"를 눈으로 확인할 수 있게 한다.

**왜 LLM 판정이 아니라 사람이 보는가**: 이 프로젝트는 "지어내지 않는다"는 데이터 정직성 원칙을 일관되게 지켜왔다(narrative.ts·comprehensive-report.ts 등의 주석 참고). LLM에게 "네가 얼마나 참고자료를 반영했는지 스스로 평가해라"라고 시키는 것은 그 자체로 신뢰할 수 없는 자기보고다 — 실제 두 글을 나란히 보여주고 사람이 판단하는 쪽이 이 프로젝트의 기존 원칙과 맞는다.

## 범위 밖

- 오늘의 해설(짧은 3~5문장 버전)은 대상에서 제외 — 사용자가 "종합보고서"만 선택함(분량이 짧아 차이가 잘 안 드러날 것으로 판단).
- 과거 리포트에 대한 소급 생성은 하지 않는다 — 오늘 이후 생성되는 리포트부터 적용.
- 자동 유사도 점수·diff 하이라이트는 만들지 않는다 — 순수 텍스트 나열, 사람이 직접 비교.

## 설계

### 1. `narrative.ts` — `generateNarrative()`에 옵션 추가

```ts
export async function generateNarrative(
  prompt: string,
  maxOutputTokens = 2048,
  options?: { skipLearningContext?: boolean }
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "[해설 생성 안 됨 — ANTHROPIC_API_KEY 미설정. 숫자·점수는 위 결과 그대로 신뢰 가능]";
  }

  let learningContext: string | undefined;
  if (!options?.skipLearningContext) {
    try {
      learningContext = await fetchRecentLearningContext();
    } catch {
      learningContext = undefined;
    }
  }
  const fullPrompt = learningContext
    ? `${prompt}\n\n참고(...)：\n${learningContext}`
    : prompt;

  const draft = await callClaude(fullPrompt, { model: "claude-sonnet-5", maxTokens: maxOutputTokens });
  return selfReviewForPlainLanguage(draft, maxOutputTokens);
}
```

기본값(`options` 생략)은 기존 동작과 완전히 동일하다 — 현재 이 함수를 부르는 4개 지점(오늘의 해설·종합보고서·주기별 리포트·디버그) 전부 옵션 없이 호출하므로 전혀 영향받지 않는다. `selfReviewForPlainLanguage`(자가검수)는 옵션과 무관하게 항상 동일하게 돈다 — 두 버전의 차이가 순수하게 "학습 요약 유무"에서만 나오게 하기 위해서다.

### 2. `comprehensive-report.ts` — `generateComprehensiveReport()`에 옵션 전달

```ts
export async function generateComprehensiveReport(
  report: Parameters<typeof buildComprehensiveReportPrompt>[0],
  options?: { skipLearningContext?: boolean }
): Promise<string> {
  let text = await generateNarrative(buildComprehensiveReportPrompt(report), MAX_OUTPUT_TOKENS, options);
  // ... 기존 로직(플레이스홀더 검증, sanitizeFormat, 영어 혼용 검사) 그대로
}
```

### 3. `pipeline.ts` — 비교용 두 번째 호출 추가

기존 종합보고서 생성(`report.details.comprehensiveReport = await generateComprehensiveReport(report)`) 직후, 옵션을 켠 두 번째 호출을 추가한다:

```ts
try {
  report.details.comprehensiveReport = await generateComprehensiveReport(report);
} catch (err) {
  report.details.comprehensiveReport = `[종합 보고서 생성 실패: ...]`;
}

try {
  report.details.comprehensiveReportNoContext = await generateComprehensiveReport(report, { skipLearningContext: true });
} catch (err) {
  sourceErrors.push({ source: "학습요약 A/B 비교(대조군)", error: ... });
  // details.comprehensiveReportNoContext는 그냥 비워둔다 — 이 실패가 리포트 저장 자체를 막지 않는다.
}
```

`details`는 이미 유연한 JSON 필드라 스키마 마이그레이션이 필요 없다. 두 번째 호출이 실패해도(비교용일 뿐이므로) 본 리포트 저장 흐름은 막지 않는다.

**비용**: 종합보고서 프롬프트(~22K 입력 토큰) 기준 1회 추가 호출 = 하루 약 $0.056, 연간 약 $20(2026-09-05 비용 분석 아티팩트 8부 기준) — 매일 계속 생성해도 무시할 만한 수준이라 기간 제한 없이 상시 생성한다.

### 4. self-learning 페이지 — 비교 섹션 추가

가장 최근 `DailyReport`(둘 다 값이 있는 것)를 조회해 "③ 적용" 항목 옆 또는 아래에 새 섹션을 추가, 두 글을 나란히(모바일은 세로로) 보여준다. 기존 "부족한 점 · 필요한 점" 3번 문구도 "측정 안 함" → "n월 n일부터 A/B 비교 제공"으로 갱신한다.

## 테스트 전략

- `narrative.test.ts`: `skipLearningContext: true`일 때 `fetchRecentLearningContext`가 호출되지 않는지, `false`/생략 시 기존과 동일하게 호출되는지.
- `comprehensive-report.test.ts`: 옵션이 `generateNarrative`로 그대로 전달되는지.
- `pipeline.ts`는 통합 성격이 강해 별도 유닛 테스트 없이 tsc+기존 스위트로 회귀만 확인(기존 관례).
- self-learning 페이지: 기존 리포트 페이지 스냅샷 성격상 별도 신규 테스트 없이 로컬 브라우저로 실동작 확인.

## 롤아웃 순서

1. `narrative.ts` 옵션 추가 + 테스트
2. `comprehensive-report.ts` 옵션 전달 + 테스트
3. `pipeline.ts` 두 번째 호출 추가
4. self-learning 페이지 UI 추가
5. 로컬 실행으로 오늘자 리포트 재생성 확인(스크립트로 1회 트리거) → 실제 사이트에서 두 글 비교 확인
