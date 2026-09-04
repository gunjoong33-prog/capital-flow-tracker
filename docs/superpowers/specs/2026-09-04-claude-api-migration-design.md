# Mistral/Groq → Claude API 전면 이관 설계

## 배경

2026-09-04 세션에서 Mistral API 계정이 `x-ratelimit-limit-req-minute: 0`으로 완전히 막힌 것을 발견했다(09-01 결제수단 미등록으로 `mistral-large-latest`가 403 차단된 것의 연장선). Groq로 대체를 시도했으나 종합보고서 프롬프트(~22,212토큰)가 이 계정의 Groq 무료 티어 TPM 한도(8,000)를 넘어 그마저 불가능했다.

사용자가 이 사이트의 LLM 작업 전체(Mistral 6개 작업 + Groq 3개 작업)를 Claude API 하나로 이관하기로 결정했다. 근거는 이전 턴에서 정리한 비용 비교(전체 이관 시 월 약 $8.20, 연 약 $98.40 — 이 사이트 트래픽 규모에서는 절대금액 차이가 미미) + 안전성(Mistral·Groq 무료 티어가 최근 두 달 새 두 차례 계정 문제로 전체 리포트 생성을 멈췄던 전례, Claude는 카드 기반 표준 종량제라 이런 유형의 사고 이력이 없음).

## 목표

- `callMistral`/`callGroq`를 쓰는 9개 작업 전부를 `callClaude()` 하나로 교체한다.
- Mistral/Groq 관련 코드(함수·재시도 로직·환경변수 참조·전용 rate-limit sleep)를 코드베이스에서 완전히 제거한다.
- 각 작업의 프롬프트 내용·호출 횟수·출력 구조는 그대로 유지한다 — 이번 이관은 "공급자만 바꾼다", 프롬프트 재설계나 자가검수 패스 개수 조정 같은 별도 개선은 범위 밖이다.

## 다루지 않는 것 (범위 밖)

- 프롬프트 자체의 재설계(예: 자가검수 패스를 1회로 줄이는 것 — Claude가 Mistral보다 지시 준수력이 나을 수 있지만, 이번 이관에서는 검증하지 않고 기존 그대로 유지)
- Claude의 prompt caching·batch API 같은 비용 최적화 기법 도입 — 월 $8 수준이라 우선순위 낮음, 필요해지면 별도 작업
- Vercel AI Gateway로의 전환 — Gateway의 핵심 이점(공급자 간 자동 폴백)을 사용자가 이미 "폴백 없음"으로 명시적으로 거부했으므로, 원시 fetch로 Anthropic API를 직접 호출하는 기존 코드 스타일을 그대로 따른다.
- Anthropic 콘솔에서 API 키 발급·크레딧 결제 — 사용자가 직접 해야 하는 계정 작업이라 이 계획의 범위 밖. 코드·테스트는 실제 크레딧 없이도 끝까지 완성 가능(모두 mock 테스트).

## 현재 상태 (이관 대상 9개 작업)

| # | 작업 | 파일 | 현재 공급자·함수 | 빈도 |
|---|---|---|---|---|
| 1 | 뉴스 헤드라인 위험도 판정 | `news-events.ts` `judgeHeadlines()` | Mistral `callMistral(prompt, 8192)` | 매일 |
| 2 | 뉴스 근접중복 클러스터 병합 | `news-events.ts` `mergeCrossSourceDuplicates()` | Mistral `callMistral(prompt, 2048)` | 매일 |
| 3 | 짧은 해설(draft) | `narrative.ts` `generateNarrative()` | Mistral `callMistral(fullPrompt, maxOutputTokens, 0.4)` | 매일 |
| 4 | 짧은 해설 자가검수 | `narrative.ts` `selfReviewForPlainLanguage()` | Mistral `callMistral(reviewPrompt, maxOutputTokens, 0.3)` | 매일(3과 세트, `generateNarrative` 내부에서 연쇄 호출) |
| 5 | 종합보고서 | `comprehensive-report.ts` `generateComprehensiveReport()` | `generateNarrative()`를 그대로 호출(직접 클라이언트 호출 없음) — 3·4와 동일 경로 재사용 | 매일 |
| 6 | 빅테크 7종목 등락 원인 | `bigtech-reasons.ts` | Groq `callGroq(prompt, { maxTokens: 2048, reasoningEffort: "low" })` (종목별 개별 호출) | 매일 |
| 7 | 뉴스 관련성 판정 | `sources/news-feeds.ts` `judgeRelevanceByLLM()` | Groq `callGroq(prompt, { maxTokens: 512, reasoningEffort: "low" })` | 수시(뉴스 갱신 크론) |
| 8 | PPT 헤드라인 카피 | `ppt-headlines.ts` `generatePptHeadlines()` | Groq `callGroq(prompt, { maxTokens: 1024, reasoningEffort: "low" })` | 매일 |
| 9 | 자가학습 노트 요약(distill) | `learning-distill.ts` `distillAndSaveLearningNotes()` | Mistral `callMistral(prompt, 1024, 0.3)` (소스별 개별 호출, CONCURRENCY=3 배치) | 매주 |
| 10 | 주간 학습 압축(synthesis) | `learning-synthesis.ts` `synthesizeWeeklyLearning()` | Mistral `callMistral(prompt, 1536, 0.3)` | 매주 |

(표에는 10행이지만 3·4·5는 사실상 한 경로를 공유하므로 "9개 작업"으로 부른다.)

## 아키텍처

`llm-clients.ts`에 `callClaude()` 하나만 남기고 `callMistral`/`callGroq`는 삭제한다. 기존 코드 스타일(원시 `fetch`, SDK 미사용)을 그대로 따른다.

```ts
export async function callClaude(
  prompt: string,
  options: { model: string; maxTokens?: number; temperature?: number }
): Promise<string> {
  const { model, maxTokens = 2048, temperature = 0.2 } = options;
  const request = () =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: "user", content: prompt }],
      }),
    });

  let res = await request();
  if (res.status === 429) {
    const waitSec = Math.min(parseRetryAfterSeconds(res, await res.text(), 20), 60);
    await sleep(Math.ceil(waitSec * 1000) + 500);
    res = await request();
  }
  if (!res.ok) throw new Error(`Claude 요청 실패: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content?: { type: string; text: string }[] };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Claude 응답에 텍스트가 없다");
  return text.trim();
}
```

- `model`은 옵션 필수(기본값 없음) — 호출부마다 명시적으로 `"claude-sonnet-5"` 또는 `"claude-haiku-4-5-20251001"`을 넘기게 강제해, "어느 작업에 어느 모델을 쓰는지"가 호출부 코드만 봐도 드러나게 한다(Mistral/Groq 시절 모델명이 함수 내부에 하드코딩돼 있던 것과 다른 점).
- 429 재시도는 기존 `callMistral`과 같은 1회 재시도 패턴을 그대로 쓴다 — Claude의 `retry-after` 헤더가 동일하게 존재함을 공식 문서로 확인했다. Claude 표준 티어(Start 기준)는 분당 1,000요청·입력 200만 토큰인데(공식 문서 확인) 이 사이트의 하루 전체 물량(약 20만 입력 토큰/일)보다 압도적으로 커서, Groq처럼 "짧은 시간에 여러 건 연달아 호출하면 재시도 중에도 또 걸리는" 문제(최대 3회 재시도)는 재현되지 않을 것으로 예상 — 1회 재시도로 충분하다고 보되, 실제 마이그레이션 후 429가 반복되면 그때 3회로 늘린다(추측성 사전 대응 안 함, YAGNI).
- `parseRetryAfterSeconds`·`sleep`·`extractJsonArray`는 공급자 중립적인 유틸이라 그대로 재사용한다.

## 모델 배정

| 작업 | 모델 | 근거 |
|---|---|---|
| 1. 뉴스 위험도 판정 | `claude-haiku-4-5-20251001` | 분류·판정 작업, 원문 그대로 옮기는 게 아니라 요약 1문장 정도라 Haiku로 충분 |
| 2. 뉴스 클러스터 병합 | `claude-haiku-4-5-20251001` | 단순 JSON 클러스터링 |
| 3·4. 짧은 해설(draft+자가검수) | `claude-sonnet-5` | 사용자에게 노출되는 한국어 서술문, 품질 중요 |
| 5. 종합보고서 | `claude-sonnet-5` (3·4와 동일 경로) | 가장 긴 한국어 서술문, 품질 최우선 |
| 6. 빅테크 원인 | `claude-haiku-4-5-20251001` | 짧은 판정 1문장 |
| 7. 뉴스 관련성 판정 | `claude-haiku-4-5-20251001` | 단순 이진 분류 |
| 8. PPT 헤드라인 | `claude-haiku-4-5-20251001` | 15자 내외 카피, 가벼운 창작 |
| 9. 자가학습 노트 요약 | `claude-sonnet-5` | 사람이 읽는 리서치 노트 프로즈, 품질 필요 |
| 10. 주간 학습 압축 | `claude-sonnet-5` | 9와 같은 이유 |

## 부수 변경

- **`pipeline.ts`의 `sleep(20_000)` 제거**(line 356) — Mistral 분당 2회 한도를 피하려고 넣었던 대기다. Claude 표준 티어는 이 사이트 하루 물량 대비 여유가 크므로 더 이상 필요 없다. 같은 이유로 `narrative.ts`의 `generateNarrative()` 내부 `sleep(20_000)`(draft→자가검수 사이)도 제거한다.
- **`pipeline.ts`는 `PROTECTED_FILES`(자동수정 파이프라인 보호 목록)에 포함된 파일**이다 — 이건 `AUTO_FIX_ENABLED`(헤드리스 자동수정) 시스템이 건드리지 못하게 막는 목록이지, 사람이 직접 검토·커밋하는 이번 작업까지 막는 건 아니다. 다만 이 파일은 핵심 파이프라인이라 변경 범위를 `sleep(20_000)` 한 줄 삭제로 최소화한다.
- **환경변수 가드 문구 교체** — `narrative.ts`(`if (!process.env.MISTRAL_API_KEY)`), `news-events.ts`의 `judgeHeadlines()`·`mergeCrossSourceDuplicates()`(`if (!process.env.MISTRAL_API_KEY ...)`)를 전부 `ANTHROPIC_API_KEY` 체크로 바꾼다.
- **`.env`**: `MISTRAL_API_KEY`·`GROQ_API_KEY` 줄은 남겨둔다(삭제 요청 없었음, 무해). `ANTHROPIC_API_KEY` 항목을 새로 추가하되 값은 비워두고 주석만 남긴다 — 사용자가 발급 후 채워 넣는다. Vercel 프로젝트 환경변수에도 동일하게 추가해야 함을 계획 마지막 태스크에 명시한다(이건 사용자가 Vercel 대시보드에서 직접 하거나, 세션에 Vercel CLI가 있으면 대신 해줄 수 있음 — 현재 이 세션엔 Vercel CLI가 설치 안 돼 있다고 알려져 있어 사용자 액션으로 남긴다).

## 테스트

- `llm-clients.test.ts`: `callGroq`/`callMistral` 테스트를 `callClaude` 테스트로 교체 — 기존 `callGroq` 테스트(성공/429 1회 재시도/실패)와 같은 패턴, Claude 응답 형태(`content: [{type:"text", text: "..."}]`)에 맞게 mock 응답만 바꾼다.
- 9개 호출부의 기존 테스트 파일(`narrative.test.ts`, `comprehensive-report.test.ts`, `news-events.test.ts`, `bigtech-reasons.test.ts`, `news-feeds.test.ts`(있다면), `ppt-headlines.test.ts`, `learning-distill.test.ts`, `learning-synthesis.test.ts`)에서 `vi.mock("@/lib/llm-clients", ...)`가 모킹하는 함수명을 `callClaude`로 바꾼다. 프롬프트 내용·기대값 검증 로직은 그대로 유지한다(공급자만 바뀌었으므로).
- 크레딧 없이도 전 과정이 mock 기반이라 끝까지 실행·통과 가능하다. 실제 API 호출 검증(크레딧 필요)은 이 계획의 마지막 단계로 별도 남긴다.

## 롤아웃 순서

폴백 없이 한 번에 전환하기로 했으므로(사용자 승인), 부분 배포보다 전체를 한 커밋으로 묶어 배포하는 편이 "일부는 Claude, 일부는 죽은 Mistral"인 어중간한 상태를 피할 수 있다. 다만 구현은 여전히 작은 단위(태스크)로 나눠 각 단계마다 테스트로 검증한다.

## 리스크 및 확인 사항

- **실제 Claude API 호출 검증은 사용자의 크레딧 충전 이후에만 가능** — 이 계획은 크레딧 충전 전까지 진행 가능한 데까지(코드+테스트 전부)를 목표로 하고, 마지막 "실제 호출로 확인" 단계는 크레딧 충전 후 별도로 진행한다.
- Haiku 4.5 모델 ID(`claude-haiku-4-5-20251001`)와 Sonnet 5 모델 ID(`claude-sonnet-5`)는 세션 시스템 프롬프트에 명시된 값을 그대로 쓴다 — 실제 계정에서 두 모델 다 사용 가능한지는 첫 실제 호출 시 확인 필요(신규 조직은 Evaluation tier로 시작해 일부 모델이 제한될 수 있다고 공식 문서에 명시돼 있음).
