# Mistral/Groq → Claude API 전면 이관 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이 사이트의 LLM 작업 9개(Mistral 6개 + Groq 3개)를 전부 Claude API 하나로 이관하고, Mistral/Groq 관련 코드를 완전히 제거한다.

**Architecture:** `llm-clients.ts`에 `callClaude(prompt, options)` 함수를 신설(원시 `fetch`, Anthropic Messages API `POST /v1/messages`)하고, 9개 호출부를 순서대로 이걸로 교체한다. 마지막 태스크에서 `callMistral`/`callGroq`와 Mistral 전용 rate-limit sleep을 제거한다.

**Tech Stack:** TypeScript, Next.js 16, Vitest, 기존 코드 스타일(SDK 없이 원시 `fetch`).

## Global Constraints

- Claude Messages API 엔드포인트: `https://api.anthropic.com/v1/messages`. 헤더: `Content-Type: application/json`, `anthropic-version: 2023-06-01`, `x-api-key: process.env.ANTHROPIC_API_KEY`.
- 요청 바디: `{ model, max_tokens, temperature, messages: [{ role: "user", content: prompt }] }`.
- 응답 바디: `{ content: [{ type: "text", text: "..." }] }` — `content` 배열에서 `type === "text"`인 첫 항목의 `text`를 꺼낸다.
- 모델 ID는 정확히 이 두 값만 쓴다: `"claude-sonnet-5"`(품질 필요 작업), `"claude-haiku-4-5-20251001"`(가벼운 판정·분류 작업). 호출부마다 `options.model`로 명시적으로 넘긴다 — 기본값 없음.
- 환경변수 이름은 `ANTHROPIC_API_KEY`다. 기존 `MISTRAL_API_KEY`/`GROQ_API_KEY` 참조를 발견하면 전부 이걸로 바꾼다.
- 각 작업의 프롬프트 문자열·호출 횟수·`maxTokens`·`temperature` 값은 그대로 유지한다 — 이번 이관은 공급자 교체만 한다, 프롬프트 내용을 고치지 않는다.
- 폴백 없음 — Claude 호출이 실패하면 그 호출부의 기존 에러 처리(있으면 그대로, 없으면 예외가 위로 전파)를 그대로 쓴다. 새 에러 처리 로직을 추가하지 않는다.
- `callMistral`/`callGroq`는 Task 6(마지막)까지 삭제하지 않는다 — 중간 태스크에서는 새 `callClaude`를 추가만 하고 기존 함수는 그대로 둬서, 각 태스크가 끝날 때마다 전체 테스트가 항상 통과하는 상태를 유지한다.
- `src/lib/pipeline.ts`는 `PROTECTED_FILES`(자동수정 파이프라인 보호 목록, `src/lib/protected-files.ts`)에 포함된 파일이다 — 이건 헤드리스 자동수정 시스템이 못 건드리게 막는 목록이지 이 계획(사람이 검토·커밋)을 막지 않는다. 다만 변경 범위를 `sleep(20_000)` 한 줄 삭제로 최소화한다(Task 6에서만 건드림).
- 실제 Claude API 호출 검증(크레딧 필요)은 이 계획에 포함하지 않는다 — 크레딧 충전 후 별도로 진행.

---

### Task 1: `callClaude()` 신설

**Files:**
- Modify: `src/lib/llm-clients.ts`
- Test: `src/lib/llm-clients.test.ts`

**Interfaces:**
- Produces: `callClaude(prompt: string, options: { model: string; maxTokens?: number; temperature?: number }): Promise<string>` — Task 2~5의 모든 호출부가 이 시그니처로 호출한다.

- [ ] **Step 1: 실패하는 테스트부터 작성**

`src/lib/llm-clients.test.ts` 최상단에 `callClaude` import를 추가하고, 파일 맨 끝(`describe("extractJsonArray", ...)` 블록 뒤)에 아래 블록을 추가한다:

```ts
// (기존 import 줄 수정)
import { callClaude, callGroq, extractJsonArray } from "./llm-clients";

// (파일 끝에 추가)
const CLAUDE_OK_BODY = { content: [{ type: "text", text: "  응답 텍스트  " }] };

describe("callClaude", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("성공 응답이면 trim된 텍스트를 반환한다(재시도 없음)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLAUDE_OK_BODY));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callClaude("프롬프트", { model: "claude-haiku-4-5-20251001" });

    expect(result).toBe("응답 텍스트");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 한 번 뒤 성공하면 정확히 1번만 재시도하고 결과를 반환한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse('{"error":"try again in 0.01s"}', 429))
      .mockResolvedValueOnce(jsonResponse(CLAUDE_OK_BODY));
    vi.stubGlobal("fetch", fetchMock);

    const promise = callClaude("프롬프트", { model: "claude-sonnet-5" });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("응답 텍스트");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("재시도 후에도 429면 에러를 던진다", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => textResponse('{"error":"try again in 0.01s"}', 429));
    vi.stubGlobal("fetch", fetchMock);

    const promise = callClaude("프롬프트", { model: "claude-sonnet-5" });
    const expectation = expect(promise).rejects.toThrow(/Claude 요청 실패: 429/);
    await vi.runAllTimersAsync();
    await expectation;

    expect(fetchMock).toHaveBeenCalledTimes(2); // 최초 1회 + 재시도 1회
  });

  it("429가 아닌 에러는 재시도 없이 즉시 던진다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse('{"error":"internal"}', 500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callClaude("프롬프트", { model: "claude-sonnet-5" })).rejects.toThrow(/Claude 요청 실패: 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Retry-After 헤더가 있으면 메시지 파싱보다 그 값을 우선한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse("{}", 429, { "retry-after": "0.01" }))
      .mockResolvedValueOnce(jsonResponse(CLAUDE_OK_BODY));
    vi.stubGlobal("fetch", fetchMock);

    const promise = callClaude("프롬프트", { model: "claude-sonnet-5" });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("응답 텍스트");
  });

  it("응답 content에 text 블록이 없으면 에러를 던진다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ content: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callClaude("프롬프트", { model: "claude-sonnet-5" })).rejects.toThrow("Claude 응답에 텍스트가 없다");
  });

  it("model·maxTokens·temperature를 요청 본문에 그대로 실어 보낸다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLAUDE_OK_BODY));
    vi.stubGlobal("fetch", fetchMock);

    await callClaude("프롬프트", { model: "claude-sonnet-5", maxTokens: 4096, temperature: 0.5 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBe(0.5);
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("maxTokens·temperature 생략 시 기본값(2048, 0.2)을 쓴다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CLAUDE_OK_BODY));
    vi.stubGlobal("fetch", fetchMock);

    await callClaude("프롬프트", { model: "claude-haiku-4-5-20251001" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(2048);
    expect(body.temperature).toBe(0.2);
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run src/lib/llm-clients.test.ts`
Expected: `callClaude` 관련 8개 테스트 FAIL(`callClaude is not a function` 또는 import 에러), 기존 `callGroq`/`extractJsonArray` 테스트는 그대로 PASS.

- [ ] **Step 3: `callClaude()` 구현**

`src/lib/llm-clients.ts`의 `callGroq` 함수 뒤, `extractJsonArray` 함수 앞에 추가:

```ts
interface ClaudeResponse {
  content?: { type: string; text: string }[];
}

/** Anthropic Messages API 직접 호출(SDK 없이 원시 fetch, Mistral/Groq와 같은 스타일).
 * 2026-09-04: Mistral 계정이 x-ratelimit-limit-req-minute: 0으로 막히고 Groq도 이 사이트의
 * 22K토큰짜리 종합보고서 프롬프트가 무료 티어 TPM(8000)을 넘어 대체 불가해, 이 사이트 LLM
 * 작업 전체를 여기로 이관한다(llm-clients.ts 상단 주석 참고). model은 호출부가 항상 명시적으로
 * 넘긴다 — 기본값을 두면 "이 작업에 어느 모델을 쓰는지"가 함수 내부에 숨어버린다. */
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
  // Claude 표준 티어(Start 기준)는 분당 1,000요청·입력 200만 토큰로 이 사이트 하루 물량보다
  // 압도적으로 여유로워(공식 문서 확인) Groq처럼 재시도 중에도 또 걸리는 문제는 예상하지 않는다
  // — Mistral과 같은 1회 재시도 패턴으로 시작하고, 실제로 반복되면 그때 늘린다(YAGNI).
  if (res.status === 429) {
    const waitSec = Math.min(parseRetryAfterSeconds(res, await res.text(), 20), 60);
    await sleep(Math.ceil(waitSec * 1000) + 500);
    res = await request();
  }
  if (!res.ok) throw new Error(`Claude 요청 실패: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as ClaudeResponse;
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Claude 응답에 텍스트가 없다");
  return text.trim();
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run src/lib/llm-clients.test.ts`
Expected: 전체 PASS(기존 `callGroq`/`extractJsonArray` 테스트 포함).

- [ ] **Step 5: 커밋**

이 프로젝트는 로컬 git 인덱스 손상 이슈가 있어 일반 `git add`/`git commit`이 아니라 플럼빙 커밋 절차를 쓴다(과거 세션 기록 참고). 컨트롤러가 직접 커밋한다(구현자는 커밋하지 않고 diff만 보고).

---

### Task 2: `narrative.ts` 이관 (해설·종합보고서 경로, Sonnet 5)

**Files:**
- Modify: `src/lib/narrative.ts`

**Interfaces:**
- Consumes: `callClaude(prompt, options)` (Task 1)
- Produces: 없음(이 파일의 공개 함수 시그니처는 안 바뀜 — `generateNarrative`, `buildDailyNarrativePrompt`)

**Context:** 이 파일이 바뀌면 `comprehensive-report.ts`(종합보고서)도 자동으로 Claude로 이관된다 — `generateComprehensiveReport()`가 `generateNarrative()`를 그대로 호출하는 구조라 별도 수정이 필요 없다. `narrative.test.ts`는 `callMistral`/`callGroq`를 모킹하지 않으므로(순수 함수만 테스트) 테스트 파일은 손댈 필요 없다.

- [ ] **Step 1: import 교체**

```ts
// 기존
import { callMistral, sleep } from "@/lib/llm-clients";

// 교체
import { callClaude } from "@/lib/llm-clients";
```

- [ ] **Step 2: `selfReviewForPlainLanguage` 내부 호출 교체**

```ts
// 기존 (line 37)
    const reviewed = await callMistral(reviewPrompt, maxOutputTokens, 0.3);

// 교체
    const reviewed = await callClaude(reviewPrompt, { model: "claude-sonnet-5", maxTokens: maxOutputTokens, temperature: 0.3 });
```

- [ ] **Step 3: `generateNarrative` 가드 문구·본문 호출 교체, rate-limit sleep 제거**

```ts
// 기존
export async function generateNarrative(prompt: string, maxOutputTokens = 2048): Promise<string> {
  if (!process.env.MISTRAL_API_KEY) {
    return "[해설 생성 안 됨 — MISTRAL_API_KEY 미설정. 숫자·점수는 위 결과 그대로 신뢰 가능]";
  }
  // ... (learningContext 조회 로직 그대로)
  const draft = await callMistral(fullPrompt, maxOutputTokens, 0.4);
  // 자가검수 패스가 연달아 두 번째 Mistral 호출을 만든다 — ... (주석 3줄)
  await sleep(20_000);
  return selfReviewForPlainLanguage(draft, maxOutputTokens);
}

// 교체
export async function generateNarrative(prompt: string, maxOutputTokens = 2048): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "[해설 생성 안 됨 — ANTHROPIC_API_KEY 미설정. 숫자·점수는 위 결과 그대로 신뢰 가능]";
  }
  // ... (learningContext 조회 로직 그대로, 수정 없음)
  const draft = await callClaude(fullPrompt, { model: "claude-sonnet-5", maxTokens: maxOutputTokens, temperature: 0.4 });
  // Claude 표준 티어는 Mistral 무료 티어(분당 2회)와 달리 이 사이트 물량 대비 압도적으로
  // 여유로워(공식 문서 확인) 연쇄 호출 사이 rate-limit 대기가 더 이상 필요 없다.
  return selfReviewForPlainLanguage(draft, maxOutputTokens);
}
```

(`learningContext` 조회 블록 — `let learningContext`부터 `const fullPrompt = ...` 까지 — 은 그대로 둔다, LLM 공급자와 무관한 로직이다.)

- [ ] **Step 4: 파일 상단 주석 갱신**

파일 맨 위 1~7행 주석("원래 Gemini... Mistral이 이 사이트가 쓰는 분석적 한국어 문체를...")을 아래로 교체 — 히스토리는 남기되 현재 상태를 정확히 반영:

```ts
// 정성적 해설(왜 이런 흐름인지 서술) 생성 — 계산은 전부 scoring/pure.ts가 결정론적으로 하고,
// 여기서는 그 결과를 자연스러운 한국어 문장으로 풀어쓰는 것만 담당한다.
//
// 2026-09-04: Gemini(하루 20건 한도) → Mistral/Groq(무료 티어 계정 문제 2회 반복, 2026-09-01
// 403·2026-09-04 요청한도 0) 순으로 거쳐 Claude API(claude-sonnet-5)로 이관했다 — 카드 기반
// 표준 종량제라 이런 유형의 계정 사고 이력이 없다(llm-clients.ts 주석 참고).
```

- [ ] **Step 5: 테스트 실행**

Run: `npx vitest run src/lib/narrative.test.ts src/lib/comprehensive-report.test.ts`
Expected: 전체 PASS(두 파일 다 순수 함수만 테스트하므로 이 변경으로 깨질 게 없어야 함).

- [ ] **Step 6: tsc 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 7: 커밋** (컨트롤러가 플럼빙 절차로)

---

### Task 3: `news-events.ts` 이관 (뉴스 판정·중복제거, Haiku 4.5)

**Files:**
- Modify: `src/lib/news-events.ts`

**Interfaces:**
- Consumes: `callClaude(prompt, options)` (Task 1)

**Context:** 이 파일에 대응하는 단위테스트 파일은 없다(`news-events.test.ts` 부재 확인) — 소스만 수정한다.

- [ ] **Step 1: import 교체**

```ts
// 기존
import { callMistral, extractJsonArray } from "@/lib/llm-clients";

// 교체
import { callClaude, extractJsonArray } from "@/lib/llm-clients";
```

- [ ] **Step 2: `judgeHeadlines` 가드·호출 교체**

```ts
// 기존 (함수 맨 앞)
async function judgeHeadlines(headlines: Headline[]): Promise<JudgedItem[]> {
  if (!process.env.MISTRAL_API_KEY || headlines.length === 0) return [];

// 교체
async function judgeHeadlines(headlines: Headline[]): Promise<JudgedItem[]> {
  if (!process.env.ANTHROPIC_API_KEY || headlines.length === 0) return [];
```

```ts
// 기존
  const text = await callMistral(prompt, 8192);

// 교체
  const text = await callClaude(prompt, { model: "claude-haiku-4-5-20251001", maxTokens: 8192 });
```

- [ ] **Step 3: `mergeCrossSourceDuplicates` 가드·호출 교체**

```ts
// 기존
export async function mergeCrossSourceDuplicates(items: JudgedItem[]): Promise<JudgedItem[]> {
  if (!process.env.MISTRAL_API_KEY || items.length < 2) return items;

// 교체
export async function mergeCrossSourceDuplicates(items: JudgedItem[]): Promise<JudgedItem[]> {
  if (!process.env.ANTHROPIC_API_KEY || items.length < 2) return items;
```

```ts
// 기존
  const text = await callMistral(prompt, 2048);

// 교체
  const text = await callClaude(prompt, { model: "claude-haiku-4-5-20251001", maxTokens: 2048 });
```

- [ ] **Step 4: tsc 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 5: 전체 테스트 실행**(회귀 확인용, 이 파일 직접 테스트는 없지만 이 파일을 import하는 다른 테스트가 있을 수 있음)

Run: `npx vitest run`
Expected: 전체 PASS.

- [ ] **Step 6: 커밋** (컨트롤러가 플럼빙 절차로)

---

### Task 4: Groq 경량 작업 3건 이관 (`bigtech-reasons.ts`, `news-feeds.ts`, `ppt-headlines.ts`, Haiku 4.5)

**Files:**
- Modify: `src/lib/bigtech-reasons.ts`
- Modify: `src/lib/sources/news-feeds.ts`
- Modify: `src/lib/ppt-headlines.ts`
- Test: `src/lib/bigtech-reasons.test.ts`
- Test: `src/lib/ppt-headlines.test.ts`

**Interfaces:**
- Consumes: `callClaude(prompt, options)` (Task 1)

- [ ] **Step 1: `bigtech-reasons.ts` 소스 교체**

```ts
// 기존
import { callGroq, extractJsonArray } from "@/lib/llm-clients";

// 교체
import { callClaude, extractJsonArray } from "@/lib/llm-clients";
```

```ts
// 기존 (line 57)
  if (!process.env.GROQ_API_KEY) return { reasons: {}, errors: [] };

// 교체
  if (!process.env.ANTHROPIC_API_KEY) return { reasons: {}, errors: [] };
```

```ts
// 기존
      const text = await callGroq(prompt, { maxTokens: 2048, reasoningEffort: "low" });

// 교체
      const text = await callClaude(prompt, { model: "claude-haiku-4-5-20251001", maxTokens: 2048 });
```

- [ ] **Step 2: `bigtech-reasons.test.ts` 갱신**

```ts
// 기존 (파일 상단)
vi.mock("@/lib/llm-clients", async () => {
  const actual = await vi.importActual<typeof import("./llm-clients")>("./llm-clients");
  return { callGroq: vi.fn(), extractJsonArray: actual.extractJsonArray };
});

import { getMetricHistoryByCount } from "@/lib/metrics";
import { fetchBigTechHeadlines } from "@/lib/sources/news-feeds";
import { callGroq } from "@/lib/llm-clients";

// 교체
vi.mock("@/lib/llm-clients", async () => {
  const actual = await vi.importActual<typeof import("./llm-clients")>("./llm-clients");
  return { callClaude: vi.fn(), extractJsonArray: actual.extractJsonArray };
});

import { getMetricHistoryByCount } from "@/lib/metrics";
import { fetchBigTechHeadlines } from "@/lib/sources/news-feeds";
import { callClaude } from "@/lib/llm-clients";
```

파일 전체에서 `callGroq` → `callClaude`로 전부 바꾼다(총 8곳: `vi.mocked(callGroq)` 6곳, `expect(callGroq)` 2곳 — Step 2의 `toHaveBeenCalledWith` 줄 제외하고는 함수 참조만 바뀌고 인자는 그대로).

```ts
// 기존 (beforeEach 안)
    vi.stubEnv("GROQ_API_KEY", "test-key");

// 교체
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
```

```ts
// 기존
  it("종목마다 maxTokens 2048로 호출한다(배치용 8192 회귀 방지)", async () => {
    vi.mocked(getMetricHistoryByCount).mockResolvedValue(history(100, 105));
    vi.mocked(callGroq).mockResolvedValue('[{"ticker":"AAA","reason":"이유","direction":"up"}]');

    await computeBigTechReasons(["AAA"], ASOF);

    expect(callGroq).toHaveBeenCalledWith(expect.any(String), { maxTokens: 2048, reasoningEffort: "low" });
  });

// 교체
  it("종목마다 maxTokens 2048로 Haiku를 호출한다(배치용 8192 회귀 방지)", async () => {
    vi.mocked(getMetricHistoryByCount).mockResolvedValue(history(100, 105));
    vi.mocked(callClaude).mockResolvedValue('[{"ticker":"AAA","reason":"이유","direction":"up"}]');

    await computeBigTechReasons(["AAA"], ASOF);

    expect(callClaude).toHaveBeenCalledWith(expect.any(String), {
      model: "claude-haiku-4-5-20251001",
      maxTokens: 2048,
    });
  });
```

```ts
// 기존
  it("GROQ_API_KEY가 없으면 Groq를 호출하지 않고 빈 결과를 반환한다", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.mocked(getMetricHistoryByCount).mockResolvedValue(history(100, 105));

    const { reasons, errors } = await computeBigTechReasons(["AAA"], ASOF);

    expect(reasons).toEqual({});
    expect(errors).toEqual([]);
    expect(callGroq).not.toHaveBeenCalled();
  });

// 교체
  it("ANTHROPIC_API_KEY가 없으면 Claude를 호출하지 않고 빈 결과를 반환한다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.mocked(getMetricHistoryByCount).mockResolvedValue(history(100, 105));

    const { reasons, errors } = await computeBigTechReasons(["AAA"], ASOF);

    expect(reasons).toEqual({});
    expect(errors).toEqual([]);
    expect(callClaude).not.toHaveBeenCalled();
  });
```

(나머지 `it(...)` 블록들은 `callGroq` → `callClaude`로 함수명만 바꾸고 로직·기대값은 그대로 — 예: `vi.mocked(callGroq).mockImplementation(...)` → `vi.mocked(callClaude).mockImplementation(...)`.)

- [ ] **Step 3: `news-feeds.ts`의 `judgeRelevanceByLLM` 소스 교체**

```ts
// 기존
import { callGroq, extractJsonArray } from "@/lib/llm-clients";
// ...
  const text = await callGroq(prompt, { maxTokens: 512, reasoningEffort: "low" });

// 교체
import { callClaude, extractJsonArray } from "@/lib/llm-clients";
// ...
  const text = await callClaude(prompt, { model: "claude-haiku-4-5-20251001", maxTokens: 512 });
```

- [ ] **Step 4: `ppt-headlines.ts` 소스 교체**

```ts
// 기존
import { callGroq, extractJsonArray } from "@/lib/llm-clients";
// ...
    text = await callGroq(prompt, { maxTokens: 1024, reasoningEffort: "low" });

// 교체
import { callClaude, extractJsonArray } from "@/lib/llm-clients";
// ...
    text = await callClaude(prompt, { model: "claude-haiku-4-5-20251001", maxTokens: 1024 });
```

- [ ] **Step 5: `ppt-headlines.test.ts` 갱신**

```ts
// 기존
vi.mock("@/lib/llm-clients", () => ({
  callGroq: vi.fn(),
  extractJsonArray: vi.fn(),
}));

import { callGroq, extractJsonArray } from "@/lib/llm-clients";

// 교체
vi.mock("@/lib/llm-clients", () => ({
  callClaude: vi.fn(),
  extractJsonArray: vi.fn(),
}));

import { callClaude, extractJsonArray } from "@/lib/llm-clients";
```

파일 전체에서 `vi.mocked(callGroq)` 4곳을 `vi.mocked(callClaude)`로 바꾼다(인자·기대값은 그대로 — 이 테스트들은 `toHaveBeenCalledWith`로 옵션을 검증하지 않으므로 그 외 변경 없음).

- [ ] **Step 6: 테스트 실행**

Run: `npx vitest run src/lib/bigtech-reasons.test.ts src/lib/ppt-headlines.test.ts`
Expected: 전체 PASS.

- [ ] **Step 7: tsc + 전체 테스트**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 에러 없음, 전체 테스트 PASS.

- [ ] **Step 8: 커밋** (컨트롤러가 플럼빙 절차로)

---

### Task 5: 자가학습 파이프라인 이관 (`learning-distill.ts`, `learning-synthesis.ts`, Sonnet 5)

**Files:**
- Modify: `src/lib/learning-distill.ts`
- Modify: `src/lib/learning-synthesis.ts`

**Interfaces:**
- Consumes: `callClaude(prompt, options)` (Task 1)

**Context:** 두 테스트 파일(`learning-distill.test.ts`, `learning-synthesis.test.ts`) 다 `callMistral`을 모킹하지 않고 프롬프트 빌더(순수 함수)만 테스트하므로, 테스트 파일은 손댈 필요 없다.

- [ ] **Step 1: `learning-distill.ts` import·호출 교체**

```ts
// 기존
import { callMistral } from "@/lib/llm-clients";

// 교체
import { callClaude } from "@/lib/llm-clients";
```

```ts
// 기존
          const raw = await callMistral(buildDistillPrompt(sourceName, sourceRecords), 1024, 0.3);
          return { sourceName, sourceRecords, summary: toPlainSentenceLines(raw) };
        } catch (e) {
          errors.push(`Mistral distill 실패(${sourceName}): ${e instanceof Error ? e.message : String(e)}`);

// 교체
          const raw = await callClaude(buildDistillPrompt(sourceName, sourceRecords), {
            model: "claude-sonnet-5",
            maxTokens: 1024,
            temperature: 0.3,
          });
          return { sourceName, sourceRecords, summary: toPlainSentenceLines(raw) };
        } catch (e) {
          errors.push(`Claude distill 실패(${sourceName}): ${e instanceof Error ? e.message : String(e)}`);
```

이 함수 위 주석("mistral-small은 초당 요청 한도가 있어 무제한 병렬은 429를 유발하므로, CONCURRENCY만큼만...")은 그대로 둔다 — `CONCURRENCY = 3` 배치 로직 자체는 공급자와 무관하게 유효한 설계(과도한 동시 요청 방지)라 유지.

- [ ] **Step 2: `learning-synthesis.ts` import·호출 교체**

```ts
// 기존
import { callMistral } from "@/lib/llm-clients";

// 교체
import { callClaude } from "@/lib/llm-clients";
```

```ts
// 기존
  const raw = await callMistral(buildSynthesisPrompt(notes), 1536, 0.3);

// 교체
  const raw = await callClaude(buildSynthesisPrompt(notes), { model: "claude-sonnet-5", maxTokens: 1536, temperature: 0.3 });
```

- [ ] **Step 3: 테스트 실행**

Run: `npx vitest run src/lib/learning-distill.test.ts src/lib/learning-synthesis.test.ts`
Expected: 전체 PASS(순수 함수 테스트라 이 변경으로 깨질 게 없어야 함).

- [ ] **Step 4: tsc + 전체 테스트**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 에러 없음, 전체 테스트 PASS.

- [ ] **Step 5: 커밋** (컨트롤러가 플럼빙 절차로)

---

### Task 6: 마무리 정리 (Mistral/Groq 제거, pipeline.ts 정리, .env)

**Files:**
- Modify: `src/lib/llm-clients.ts`
- Modify: `src/lib/llm-clients.test.ts`
- Modify: `src/lib/pipeline.ts`
- Modify: `.env`

**Interfaces:**
- Consumes: 없음(정리 작업)

**Context:** Task 2~5로 9개 호출부가 전부 `callClaude`로 이관됐다 — 이제 `callMistral`/`callGroq`를 참조하는 코드가 전혀 없어야 한다(Step 1 전에 grep으로 확인).

- [ ] **Step 1: 남은 참조 확인**

Run: `grep -rn "callMistral\|callGroq" src/ --include="*.ts" --include="*.tsx"`
Expected: `llm-clients.ts`(함수 정의 자체) 외에는 아무 결과도 없어야 함. 남은 참조가 있으면 이 태스크를 진행하기 전에 먼저 잡아야 한다(Task 2~5 중 하나가 빠뜨린 호출부).

- [ ] **Step 2: `llm-clients.ts`에서 `callMistral`·`callGroq` 삭제**

`callMistral` 함수 전체(주석 포함)와 `callGroq` 함수 전체(주석 포함)를 삭제한다. `parseRetryAfterSeconds`·`extractJsonArray`·`sleep`은 `callClaude`가 계속 쓰므로 유지한다.

파일 최상단 주석(1~10행, "Gemini 무료 티어... 둘 다 OpenAI 호환 chat/completions 포맷이라...")을 아래로 교체:

```ts
// Claude API(Anthropic Messages API) 직접 호출 — 원래 Gemini(하루 20건 한도) → Mistral+Groq
// (무료 티어 계정 문제 반복: 2026-09-01 403, 2026-09-04 요청한도 0)를 거쳐 이관했다. 카드 기반
// 표준 종량제라 이런 유형의 계정 사고 이력이 없다. 이 사이트 LLM 작업 9개 전부가 이 함수 하나로
// 통일됐다 — 품질 필요 작업은 claude-sonnet-5, 가벼운 판정·분류는 claude-haiku-4-5-20251001.
```

- [ ] **Step 3: `llm-clients.test.ts`에서 `callGroq` describe 블록 삭제**

`describe("callGroq", ...)` 블록 전체(Task 1 이전부터 있던 8개 테스트)를 삭제한다. `describe("callClaude", ...)`(Task 1에서 추가)와 `describe("extractJsonArray", ...)`는 유지. 최상단 import도 `callGroq` 제거:

```ts
// 기존
import { callClaude, callGroq, extractJsonArray } from "./llm-clients";

// 교체
import { callClaude, extractJsonArray } from "./llm-clients";
```

- [ ] **Step 4: `pipeline.ts`의 Mistral 전용 rate-limit sleep 제거**

```ts
// 기존 (line 351~359 부근)
      narrative = await generateNarrative(buildDailyNarrativePrompt(report));
      // ... (에러 처리 catch 블록, 있으면 그대로 유지)
    }

    await sleep(20_000);

    try {
      report.details.comprehensiveReport = await generateComprehensiveReport(report);

// 교체 — sleep(20_000) 줄만 삭제
      narrative = await generateNarrative(buildDailyNarrativePrompt(report));
      // ... (에러 처리 catch 블록, 있으면 그대로 유지)
    }

    try {
      report.details.comprehensiveReport = await generateComprehensiveReport(report);
```

`sleep` import가 이 파일의 다른 곳에서도 쓰이는지 확인하고(Run: `grep -n "sleep(" src/lib/pipeline.ts`), 이 자리 말고 다른 용도로 안 쓰이면 `import { ..., sleep } from "@/lib/llm-clients"`에서 `sleep`도 함께 제거한다. 다른 곳에서도 쓰이면 import는 그대로 둔다.

- [ ] **Step 5: `.env`에 `ANTHROPIC_API_KEY` 자리 추가**

`.env` 파일에서 `MISTRAL_API_KEY=` 줄 다음에 추가(기존 `MISTRAL_API_KEY`·`GROQ_API_KEY` 줄은 삭제하지 않고 그대로 둔다 — 무해하고 삭제 요청 없었음):

```
# Claude API(Anthropic) — 2026-09-04 Mistral/Groq에서 전면 이관. console.anthropic.com에서
# 발급 후 크레딧 충전 필요(선불 크레딧 방식, 카드 등록만으론 호출 안 됨).
ANTHROPIC_API_KEY=
```

Vercel 프로젝트 환경변수에도 같은 키를 추가해야 실제 배포본이 동작한다 — 이건 사용자가 Vercel 대시보드에서 직접 추가하거나, 다음 세션에서 Vercel CLI가 설치돼 있으면 그걸로 대신할 수 있다(이번 계획 범위 밖, 컨트롤러가 태스크 완료 보고에 명시).

- [ ] **Step 6: 전체 테스트 + tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전체 테스트 PASS, tsc 에러 없음.

- [ ] **Step 7: 커밋 + 푸시 + 배포**

컨트롤러가 플럼빙 절차로 커밋(지금까지 태스크 1~6을 태스크별로 개별 커밋했다면 이 태스크만, 한 번에 묶었다면 전체) 후 `git push origin master`. Vercel 자동 배포 확인.

- [ ] **Step 8: 실사용 안내**

`ANTHROPIC_API_KEY`에 실제 값이 아직 없으므로, 배포 직후 실제 리포트 생성은 `generateNarrative()`의 가드(`"[해설 생성 안 됨 — ANTHROPIC_API_KEY 미설정]"`)에 걸려 여전히 실패한다 — 이건 코드 버그가 아니라 예상된 상태다. 사용자가 크레딧 충전 후 키를 `.env`(로컬)와 Vercel 프로젝트 환경변수에 넣으면 그 순간부터 정상 동작한다. 컨트롤러는 이 사실을 최종 보고에 명시하고, 실제 API 호출 검증은 별도 후속 작업으로 남긴다(이 계획의 범위 밖).
