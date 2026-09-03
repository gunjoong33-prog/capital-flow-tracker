# 자가학습 4요소 실제 적용 강화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자가학습 파이프라인이 뽑는 4요소(지표 수집법·사고과정·보고형식·배경지식)를 주 1회
압축한 "이번 주 학습 요약" 하나로 만들어, 매일 4곳(일일 narrative·종합보고서·주기별 리포트·
debug 라우트)의 리포트 프롬프트에 재사용되게 한다.

**Architecture:** `learning-distill.ts`의 distill 프롬프트에 4번째 요소를 추가하고, 새 파일
`learning-synthesis.ts`가 이번 주 `LearningNote` 전체를 LLM 1회로 압축해 새 테이블
`WeeklyLearningSynthesis`에 저장한다. `narrative-learning-context.ts`는 이 압축본 1건만 읽도록
바뀌고, 일요일 23:00 KST 크론이 압축을 트리거한다.

**Tech Stack:** Next.js 16 · Prisma 7 · Neon Postgres · Vitest · Mistral(`mistral-small-latest`)

## Global Constraints

- 채점 엔진(`src/lib/scoring/pure.ts`, `src/lib/scoring/run.ts`)은 절대 수정하지 않는다.
- 각 태스크 완료 전 `npx tsc --noEmit`과 `npx vitest run`을 실행해 통과를 확인한다.
- 커밋 메시지 끝에 다음을 그대로 붙인다:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HRPufqkdifH4nDu23eAPdP
  ```
- 이 저장소는 로컬 git 인덱스가 sparse-checkout 이상으로 `git status`가 신뢰 불가능한 상태다
  (`문제점 및 보완점/트래커.md` 참고). 커밋할 땐 `git add -A`를 쓰지 말고, 이번 태스크가 실제로
  건드린 파일 경로만 정확히 나열해서 `git add <path...>` 하거나, 직전 커밋들이 쓴
  `git commit-tree` 플럼빙 방식을 재사용한다.
- 참고 문서: `docs/superpowers/specs/2026-09-02-learning-application-design.md`

---

### Task 1: `WeeklyLearningSynthesis` 테이블 추가

**Files:**
- Modify: `prisma/schema.prisma` (line 166 뒤, `LearningNote` 모델 다음)

**Interfaces:**
- Produces: Prisma 모델 `WeeklyLearningSynthesis { id, periodKey (unique), content, createdAt }`,
  이후 태스크가 `db.weeklyLearningSynthesis.findFirst/upsert`로 씀.

- [ ] **Step 1: `prisma/schema.prisma`에 모델 추가**

`model LearningNote { ... }` 블록(166번째 줄 `}`) 바로 뒤에 추가:

```prisma

// learning-distill.ts가 만드는 개별 기관 노트(LearningNote)를 매주 한 번 더 LLM으로 압축한
// "이번 주 학습 요약" 1건 — 매일 리포트 프롬프트가 원문 노트를 통째로 재전송하지 않고 이 압축본만
// 참고하게 하기 위함(비용·지연·플레이스홀더 준수율 저하 위험 완화, 설계 문서
// docs/superpowers/specs/2026-09-02-learning-application-design.md 참고).
model WeeklyLearningSynthesis {
  id        String   @id @default(cuid())
  periodKey String   @unique
  content   String
  createdAt DateTime @default(now())
}
```

- [ ] **Step 2: 마이그레이션 생성 및 적용**

Run: `npx prisma migrate dev --name add_weekly_learning_synthesis`
Expected: `prisma/migrations/<timestamp>_add_weekly_learning_synthesis/migration.sql` 생성,
"Your database is now in sync with your schema." 출력, Prisma Client 재생성 완료.

- [ ] **Step 3: 타입 생성 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (생성된 Prisma Client에 `WeeklyLearningSynthesis` 타입이 잡혔는지 간접 확인).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "$(cat <<'EOF'
feat: WeeklyLearningSynthesis 테이블 추가

자가학습 노트를 주 1회 압축해 저장할 테이블. LearningNote에 특수
sentinel 행을 끼워 넣지 않고 별도 테이블로 분리해 자가학습 페이지의
기관별 필터가 이 압축본을 기관 하나로 오집계하는 걸 방지한다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HRPufqkdifH4nDu23eAPdP
EOF
)"
```

---

### Task 2: `learning-distill.ts` — ④ 배경지식 요소 추가 + `isoWeekKey` export

**Files:**
- Modify: `src/lib/learning-distill.ts:52` (`isoWeekKey` export), `:82-101` (`buildDistillPrompt`)
- Modify: `src/lib/learning-distill.test.ts`

**Interfaces:**
- Consumes: 없음(기존 파일 내부 수정).
- Produces: `export function isoWeekKey(d: Date): string`(Task 3이 씀), `buildDistillPrompt()`가
  4요소를 요청하는 프롬프트를 반환.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/learning-distill.test.ts`의 `describe("buildDistillPrompt", ...)` 블록 안, 마지막
`it(...)` 다음에 추가:

```ts
  it("넷째 요소(배경지식)를 프롬프트에 포함한다", () => {
    const prompt = buildDistillPrompt("Bridgewater Associates", [
      { id: "test-id-1", sourceType: "13f", date: new Date("2026-08-14"), payload: { nameOfIssuer: "APPLE INC" } },
    ]);

    expect(prompt).toContain("배경지식");
    expect(prompt).toContain("넷째");
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/lib/learning-distill.test.ts`
Expected: 새 테스트 FAIL("배경지식" 문자열이 아직 프롬프트에 없음).

- [ ] **Step 3: `isoWeekKey`를 export로 바꾼다**

`src/lib/learning-distill.ts:53`:

```ts
// 변경 전
function isoWeekKey(d: Date): string {
```
```ts
// 변경 후
export function isoWeekKey(d: Date): string {
```

- [ ] **Step 4: `buildDistillPrompt`에 넷째 요소 추가**

`src/lib/learning-distill.ts`의 `return` 문(93-107줄)을 찾는다. 변경 전 내용:

```ts
  return `너는 매크로 리서치 애널리스트다. 아래는 "${sourceName}"의 최근 공개 데이터다.
이 데이터만 근거로 다음 세 가지를 한국어 3~5문장으로 요약해라 — 이 기관이 첫째 어떤 지표를 근거로
쓰는지(지표 수집 방법), 둘째 그 지표를 어떤 논리로 해석해 어떤 결론에 도달하는지(사고 과정),
셋째 결론을 어떤 형식·어조로 전달하는지(보고 방식 — 예: 수치를 먼저 제시하는지 서술을 먼저 하는지,
확정적으로 단언하는지 조건부로 표현하는지, 몇 개 시나리오로 나누는지 등).

*** 형식 규칙(중요) ***
- 굵게(**) 표시나 마크다운 서식을 쓰지 마라 — 일반 텍스트로만 써라.
- "①", "②", "1.", "첫째," 같은 번호나 소제목을 답변에 그대로 옮기지 마라 — 세 가지를 순서대로
  다루되, 번호 없이 자연스러운 문장으로 이어 써라.
- AI가 형식적으로 답한 것처럼 보이지 않게, 사람이 정리한 리서치 노트처럼 편하게 써라.
데이터에 없는 내용을 지어내지 마라. 존댓말 아닌 평서체로.
${truncationNotes.length > 0 ? `\n${truncationNotes.join("\n")}\n` : ""}
데이터:
${JSON.stringify(cappedRecords, null, 2)}`;
```

이걸 아래로 교체:

```ts
  return `너는 매크로 리서치 애널리스트다. 아래는 "${sourceName}"의 최근 공개 데이터다.
이 데이터만 근거로 다음 네 가지를 한국어 4~6문장으로 요약해라 — 이 기관이 첫째 어떤 지표를 근거로
쓰는지(지표 수집 방법), 둘째 그 지표를 어떤 논리로 해석해 어떤 결론에 도달하는지(사고 과정),
셋째 결론을 어떤 형식·어조로 전달하는지(보고 방식 — 예: 수치를 먼저 제시하는지 서술을 먼저 하는지,
확정적으로 단언하는지 조건부로 표현하는지, 몇 개 시나리오로 나누는지 등), 넷째 이 자료가 실제로
다룬 핵심 내용(배경지식 — 어떤 사실·수치·주장을 구체적으로 다뤘는지, 예: "미국 금리 3.625%를
근거로 긴축 기조 유지를 전망했다"처럼 구체적으로).

*** 형식 규칙(중요) ***
- 굵게(**) 표시나 마크다운 서식을 쓰지 마라 — 일반 텍스트로만 써라.
- "①", "②", "1.", "첫째," 같은 번호나 소제목을 답변에 그대로 옮기지 마라 — 네 가지를 순서대로
  다루되, 번호 없이 자연스러운 문장으로 이어 써라.
- AI가 형식적으로 답한 것처럼 보이지 않게, 사람이 정리한 리서치 노트처럼 편하게 써라.
데이터에 없는 내용을 지어내지 마라. 존댓말 아닌 평서체로.
${truncationNotes.length > 0 ? `\n${truncationNotes.join("\n")}\n` : ""}
데이터:
${JSON.stringify(cappedRecords, null, 2)}`;
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/lib/learning-distill.test.ts`
Expected: 전체 PASS(기존 3개 + 신규 1개 = 4개).

- [ ] **Step 6: 전체 검증**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 에러 없음, 전체 테스트 PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/learning-distill.ts src/lib/learning-distill.test.ts
git commit -m "$(cat <<'EOF'
feat: distill 프롬프트에 넷째 요소(배경지식) 추가

기존 3요소(지표 수집법·사고과정·보고형식)에 "이 자료가 실제로 다룬
핵심 내용(배경지식)"을 추가한다. isoWeekKey()를 export해 다음
태스크(주간 압축)가 재사용할 수 있게 한다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HRPufqkdifH4nDu23eAPdP
EOF
)"
```

---

### Task 3: `learning-synthesis.ts` 신설 — 주간 압축

**Files:**
- Create: `src/lib/learning-synthesis.ts`
- Create: `src/lib/learning-synthesis.test.ts`

**Interfaces:**
- Consumes: `isoWeekKey` from `@/lib/learning-distill`(Task 2), `callMistral` from
  `@/lib/llm-clients`, `toPlainSentenceLines` from `@/lib/text-format`, `db` from `@/lib/db`,
  `db.weeklyLearningSynthesis`(Task 1).
- Produces: `export function buildSynthesisPrompt(notes: {category:string; sourceName:string;
  summary:string}[]): string`, `export async function synthesizeWeeklyLearning(): Promise<{
  periodKey: string; content: string } | null>`(Task 6의 크론 라우트가 씀).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/learning-synthesis.test.ts` 신규 생성:

```ts
import { describe, expect, it, vi } from "vitest";

// learning-distill.ts(isoWeekKey)를 import하고, learning-distill.ts가 "@/lib/db"를 최상단에서
// import한다 — db.ts는 DATABASE_URL이 없으면 즉시 throw한다(vitest는 .env를 자동 로드하지
// 않음). learning-distill.test.ts와 동일한 방식으로 mock한다.
vi.mock("@/lib/db", () => ({ db: {} }));

import { buildSynthesisPrompt } from "./learning-synthesis";

describe("buildSynthesisPrompt", () => {
  it("노트 개수와 각 노트의 기관·요약을 프롬프트에 포함한다", () => {
    const prompt = buildSynthesisPrompt([
      { category: "자산운용사", sourceName: "PIMCO Cyclical Outlook", summary: "신용 스프레드 확대를 경고했다." },
      { category: "중앙은행", sourceName: "ECB", summary: "소비자 기대조사를 근거로 삼았다." },
    ]);

    expect(prompt).toContain("2건");
    expect(prompt).toContain("PIMCO Cyclical Outlook");
    expect(prompt).toContain("신용 스프레드 확대를 경고했다");
    expect(prompt).toContain("ECB");
  });

  it("특정 기관을 문장 주어로 쓰지 말라는 규칙을 포함한다", () => {
    const prompt = buildSynthesisPrompt([
      { category: "은행", sourceName: "BIS", summary: "정책금리를 근거로 삼았다." },
    ]);

    expect(prompt).toContain("주어로 쓰지 마라");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/lib/learning-synthesis.test.ts`
Expected: FAIL("./learning-synthesis" 모듈을 찾을 수 없음).

- [ ] **Step 3: `src/lib/learning-synthesis.ts` 구현**

```ts
// learning-distill.ts가 만드는 개별 기관 LearningNote를 매주 한 번 더 LLM으로 압축해
// "이번 주 학습 요약" 하나로 만든다. 매일 리포트 프롬프트가 원문 노트를 통째로 재전송하지
// 않고 이 압축본 1건만 재사용하게 하기 위함(설계 문서
// docs/superpowers/specs/2026-09-02-learning-application-design.md 참고) — 컨텍스트 길이
// 자체는 문제가 아니었지만(mistral-small-latest 실측 한도 262K 토큰), 비용·지연·
// 플레이스홀더 준수율 저하 위험을 줄이기 위해 압축한다.
import { db } from "@/lib/db";
import { callMistral } from "@/lib/llm-clients";
import { toPlainSentenceLines } from "@/lib/text-format";
import { isoWeekKey } from "@/lib/learning-distill";

type NoteForSynthesis = { category: string; sourceName: string; summary: string };

export function buildSynthesisPrompt(notes: NoteForSynthesis[]): string {
  const body = notes.map((n) => `[${n.category}/${n.sourceName}]\n${n.summary}`).join("\n\n");
  return `너는 여러 기관의 리서치를 종합하는 애널리스트다. 아래는 이번 주 여러 기관(증권사·
중앙은행·국제기구·자산운용사 등)에서 뽑은 학습 노트 ${notes.length}건이다. 각 노트는 그 기관이
①어떤 지표를 근거로 쓰는지, ②어떤 논리로 결론에 도달하는지, ③어떤 형식으로 보고하는지, ④실제로
어떤 내용을 다뤘는지를 담고 있다.

이 노트 전체를 하나로 종합해 "이번 주 학습 요약"을 한국어 6~10문장으로 써라.

*** 규칙 ***
- 개별 기관 이름을 문장의 주어로 쓰지 마라(예: "PIMCO는 ~라고 했다" 금지) — "여러 기관이
  공통으로 ~하는 경향을 보였다", "이번 주 리서치에서는 ~가 자주 다뤄졌다"처럼 전체 경향으로
  종합해라.
- 지표·사고방식·보고 형식의 경향뿐 아니라, 실제로 어떤 주제·수치·전망이 많이 다뤄졌는지(배경
  지식)도 반드시 포함해라.
- 굵게(**) 표시나 마크다운 서식, 번호를 쓰지 마라 — 일반 텍스트로만 써라.
- 데이터에 없는 내용을 지어내지 마라.

학습 노트:
${body}`;
}

/** 이번 주 LearningNote 전체를 압축해 WeeklyLearningSynthesis에 저장한다. 노트가 하나도
 * 없으면(신규 배포 첫 주 등) null을 반환하고 아무것도 저장하지 않는다 — 에러 아님. */
export async function synthesizeWeeklyLearning(): Promise<{ periodKey: string; content: string } | null> {
  const periodKey = isoWeekKey(new Date());
  const notes = await db.learningNote.findMany({ where: { periodKey } });
  if (notes.length === 0) return null;

  const raw = await callMistral(buildSynthesisPrompt(notes), 1536, 0.3);
  const content = toPlainSentenceLines(raw);

  await db.weeklyLearningSynthesis.upsert({
    where: { periodKey },
    create: { periodKey, content },
    update: { content },
  });

  return { periodKey, content };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/learning-synthesis.test.ts`
Expected: PASS(2개).

- [ ] **Step 5: 전체 검증**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 에러 없음, 전체 테스트 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/learning-synthesis.ts src/lib/learning-synthesis.test.ts
git commit -m "$(cat <<'EOF'
feat: 이번 주 학습 요약 압축 로직(learning-synthesis.ts) 추가

synthesizeWeeklyLearning()이 이번 주 LearningNote 전체를 LLM 1회로
압축해 WeeklyLearningSynthesis에 upsert한다. 노트가 0건이면 조용히
건너뛴다(에러 아님).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HRPufqkdifH4nDu23eAPdP
EOF
)"
```

---

### Task 4: `narrative-learning-context.ts` — 조회 대상을 압축본으로 교체

**Files:**
- Modify: `src/lib/narrative-learning-context.ts`(전체 교체)
- Modify: `src/lib/narrative-learning-context.test.ts`(전체 교체)

**Interfaces:**
- Consumes: `db.weeklyLearningSynthesis.findFirst`(Task 1).
- Produces: `fetchRecentLearningContext(): Promise<string | undefined>` — 시그니처는 그대로라
  `narrative.ts`(Task 5)는 수정 불필요.

- [ ] **Step 1: 실패하는 테스트로 교체**

`src/lib/narrative-learning-context.test.ts` 전체를 아래로 교체:

```ts
import { describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { weeklyLearningSynthesis: { findFirst } } }));

import { fetchRecentLearningContext } from "./narrative-learning-context";

describe("fetchRecentLearningContext", () => {
  it("압축본이 없으면 undefined를 반환한다", async () => {
    findFirst.mockResolvedValueOnce(null);

    const result = await fetchRecentLearningContext();

    expect(result).toBeUndefined();
  });

  it("압축본이 있으면 content를 그대로 반환한다", async () => {
    findFirst.mockResolvedValueOnce({
      periodKey: "2026-W36",
      content: "이번 주 여러 기관은 조건부 서술을 선호했다.",
    });

    const result = await fetchRecentLearningContext();

    expect(result).toBe("이번 주 여러 기관은 조건부 서술을 선호했다.");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/lib/narrative-learning-context.test.ts`
Expected: FAIL(옛 구현이 `db.learningNote`를 찾다가 `undefined.findMany` 에러, 또는 반환값 불일치).

- [ ] **Step 3: `src/lib/narrative-learning-context.ts` 전체 교체**

```ts
// generateNarrative(narrative.ts)에 WeeklyLearningSynthesis(주간 압축본)를 공급하는 DB 접근
// 계층. narrative.ts 자체에 db import를 넣으면 그 유일한 순수 로직 테스트 파일
// (narrative.test.ts)이 db.ts의 "DATABASE_URL 없으면 즉시 throw"에 끌려 들어간다(CI엔
// 시크릿이 없다) — 그래서 DB 접근만 이 파일로 분리한다(external-consensus.ts/
// learning-distill.ts와 같은 오케스트레이션-계층 분리 관례).
//
// 2026-09-02: 최근 LearningNote 5건을 직접 읽던 방식에서, learning-synthesis.ts가 매주 한 번
// 압축해둔 WeeklyLearningSynthesis 1건만 읽는 방식으로 바꿨다 — 매일 4회(narrative·
// comprehensiveReport·periodReport·debug) 호출마다 원문을 통째로 재전송하지 않기 위함.
import { db } from "@/lib/db";

/** 가장 최근 주간 학습 요약을 해설 프롬프트에 참고자료로 얹을 문자열로 반환한다. 없으면 undefined. */
export async function fetchRecentLearningContext(): Promise<string | undefined> {
  const synthesis = await db.weeklyLearningSynthesis.findFirst({ orderBy: { createdAt: "desc" } });
  return synthesis?.content;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/narrative-learning-context.test.ts`
Expected: PASS(2개).

- [ ] **Step 5: 전체 검증**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 에러 없음, 전체 테스트 PASS(`narrative.test.ts`도 시그니처 변경 없으므로 그대로 통과).

- [ ] **Step 6: Commit**

```bash
git add src/lib/narrative-learning-context.ts src/lib/narrative-learning-context.test.ts
git commit -m "$(cat <<'EOF'
feat: 학습 컨텍스트 조회를 최근 5건 노트에서 주간 압축본으로 교체

fetchRecentLearningContext()가 이제 WeeklyLearningSynthesis 최신
1건의 content를 그대로 반환한다. 반환 타입(Promise<string|undefined>)은
그대로라 narrative.ts는 수정할 필요 없다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HRPufqkdifH4nDu23eAPdP
EOF
)"
```

---

### Task 5: `narrative.ts` — 주입 문구를 "배경 맥락 허용"으로 완화

**Files:**
- Modify: `src/lib/narrative.ts:51-53`

**Interfaces:**
- Consumes: `fetchRecentLearningContext()`(Task 4, 시그니처 불변).
- Produces: 없음(문자열만 변경, 다른 파일이 이 문구 자체를 참조하지 않음).

이 함수(`generateNarrative`)는 외부 LLM을 직접 호출해 기존에도 단위테스트가 없다(코드베이스
전체에서 동일 — `narrative.test.ts`는 `buildDailyNarrativePrompt`만 테스트한다). 자동화된 테스트
없이 문자열만 정확히 바꾸고 타입체크로 검증한다.

- [ ] **Step 1: 주입 문구 교체**

`src/lib/narrative.ts:51-53`:

```ts
// 변경 전
  const fullPrompt = learningContext
    ? `${prompt}\n\n참고(다른 기관들의 최근 해석 방법론 — 오늘의 사실로 인용하지 말고, 서술 방식의 참고 자료로만 써라):\n${learningContext}`
    : prompt;
```
```ts
// 변경 후
  const fullPrompt = learningContext
    ? `${prompt}\n\n참고(이번 주 여러 기관의 학습 요약 — 지표·사고과정·보고형식·배경지식을 종합한 것이다. 오늘 분석의 배경 맥락으로 삼아 반영하되, 특정 기관이 이렇게 말했다는 식으로 직접 인용하거나 이 사이트 자체의 사실인 것처럼 단정하지 마라):\n${learningContext}`
    : prompt;
```

- [ ] **Step 2: 검증**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 에러 없음, 전체 테스트 PASS(이 줄을 직접 테스트하는 케이스가 없으므로 회귀 없이 그대로
통과해야 정상).

- [ ] **Step 3: Commit**

```bash
git add src/lib/narrative.ts
git commit -m "$(cat <<'EOF'
feat: 학습 요약 주입 문구를 배경 맥락 반영 허용으로 완화

기존 "서술 방식만 참고하라"는 지시를 "배경 맥락으로 삼아 분석에
반영하되 직접 인용·사실처럼 단정은 금지"로 바꿔, 사용자가 요청한
넷째 요소(배경지식)가 실제로 분석에 영향을 주게 한다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HRPufqkdifH4nDu23eAPdP
EOF
)"
```

---

### Task 6: 주간 압축 크론 라우트

**Files:**
- Create: `src/app/api/cron/learning-synthesis/route.ts`

**Interfaces:**
- Consumes: `synthesizeWeeklyLearning()`(Task 3), `requireCronAuth` from `@/lib/cron-auth`,
  `sendHealthCheckAlert` from `@/lib/discord-alert`(기존 함수, 시그니처 불변).
- Produces: `GET /api/cron/learning-synthesis` 엔드포인트(Task 7이 배포 후 수동 트리거로 검증,
  이후 cron-job.org가 매주 호출).

이 코드베이스의 다른 크론 라우트(`learning-distill/route.ts` 등)도 라우트 자체 단위테스트가
없다 — `requireCronAuth`/`sendHealthCheckAlert`가 이미 각자 테스트돼 있고, 라우트는 그 둘을
얇게 잇기만 한다.

- [ ] **Step 1: `src/app/api/cron/learning-synthesis/route.ts` 생성**

```ts
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { synthesizeWeeklyLearning } from "@/lib/learning-synthesis";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

export const dynamic = "force-dynamic";
// LLM 1회 호출뿐이라(학습노트 20+건을 순차 distill하는 learning-distill과 다름) 기본 60초로
// 충분하다.
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await synthesizeWeeklyLearning();
    return NextResponse.json(result ?? { skipped: true, reason: "이번 주 학습 노트 없음" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendHealthCheckAlert(`주간 학습 요약 생성 실패: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: 검증**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/learning-synthesis/route.ts
git commit -m "$(cat <<'EOF'
feat: 주간 학습 요약 크론 라우트 추가

/api/cron/learning-synthesis — synthesizeWeeklyLearning()을
requireCronAuth로 보호해 호출한다. 실패 시 Discord 알림.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HRPufqkdifH4nDu23eAPdP
EOF
)"
```

---

### Task 7: 자가학습 페이지에 "이번 주 학습 요약" 섹션 추가

**Files:**
- Modify: `src/app/correction-process/self-learning/page.tsx`

**Interfaces:**
- Consumes: `db.weeklyLearningSynthesis.findFirst`(Task 1), 기존 `styles.noteSample`/
  `noteSampleHead`/`noteSampleBody`(page.module.css, 이미 존재).
- Produces: 없음(페이지 렌더링만 추가).

- [ ] **Step 1: 쿼리 추가**

`src/app/correction-process/self-learning/page.tsx`의 `export default async function
SelfLearningPage() {` 블록 안, 기존 `Promise.all([...])` 구문(현재 `collectionBySource,
totalCollected, ..., notesBySourceName` 구조분해) 바로 다음 줄에 추가:

```ts
  const weeklySynthesis = await db.weeklyLearningSynthesis.findFirst({ orderBy: { createdAt: "desc" } });
```

- [ ] **Step 2: 섹션 렌더링 추가**

`"① 수집 — 소스별 현황"` `<h2>` 바로 앞(현재 stageGrid `</div>` 다음)에 삽입:

```tsx
        {weeklySynthesis && (
          <>
            <h2 className={styles.sectionHeading}>이번 주 학습 요약 — 매일 리포트에 실제로 주입됨</h2>
            <div className={styles.noteSample}>
              <div className={styles.noteSampleHead}>
                <span>periodKey: {weeklySynthesis.periodKey}</span>
                <span>{fmtDateTime(weeklySynthesis.createdAt)}</span>
              </div>
              <p className={styles.noteSampleBody}>{weeklySynthesis.content}</p>
            </div>
          </>
        )}

```

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 에러 없음, 전체 테스트 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/correction-process/self-learning/page.tsx
git commit -m "$(cat <<'EOF'
feat: 자가학습 페이지에 이번 주 학습 요약 섹션 추가

WeeklyLearningSynthesis 최신 1건을 그대로 노출해, 넷째 요소
(배경지식)가 실제로 반영되고 있다는 걸 육안으로 검증할 수 있게 한다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HRPufqkdifH4nDu23eAPdP
EOF
)"
```

---

### Task 8: 배포 + cron-job.org 등록 + 수동 1회 실행 검증

**Files:** 없음(운영 작업).

**Interfaces:**
- Consumes: Task 1~7에서 만든 `/api/cron/learning-synthesis`, 배포된 프로덕션 URL.

- [ ] **Step 1: 최종 검증**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 에러 없음, 전체 테스트 PASS.

- [ ] **Step 2: 이 세션이 써온 git plumbing 방식으로 원격에 반영**

로컬 sparse-checkout 인덱스가 불안정하므로 `git status`를 믿지 말고, 이번 계획이 실제로
건드린 파일만 골라 커밋을 쌓는다(Task 1~7에서 이미 각각 커밋했다면 이 단계는 `git push
origin master`만 하면 된다). 원격이 앞서 있으면(예: 자동 옵시디언 export 커밋) `git fetch`
후 그 변경이 `src`/`prisma`/`docs`를 안 건드렸는지 `git diff <old> <new> --stat -- src prisma
docs`로 확인하고, 문제없으면 새 부모 위에 같은 트리를 다시 커밋한다(앞선 세션에서 반복
사용한 절차).

- [ ] **Step 3: Vercel 프로덕션 배포**

Run: `vercel --prod --yes`
Expected: `"readyState": "READY"` JSON 응답.

- [ ] **Step 4: `CRON_JOB_ORG_API_KEY`를 `.env`에 추가(아직 없다면)**

`ObsidianVault/Macroeconomic Analysis/capital-flow-tracker/API 키.md`에 이미 기록된
`CRON_JOB_ORG_API_KEY` 값을 로컬 `.env`에 다음 줄로 추가한다(파일 끝에):

```
CRON_JOB_ORG_API_KEY=<Obsidian 문서에 기록된 값>
```

- [ ] **Step 5: cron-job.org에 새 잡 등록**

`CRON_SECRET`(`.env`에 이미 있음)을 Authorization 헤더로 쓰는 기존 `news-refresh`/`jpy-check`
잡과 같은 방식으로, 아래 스크립트를 1회 실행해 일요일 23:00 KST(=14:00 UTC, 일요일=요일 코드
0) 주기로 `/api/cron/learning-synthesis`를 호출하는 잡을 등록한다:

```bash
node -e '
require("dotenv").config();
const key = process.env.CRON_JOB_ORG_API_KEY;
const cronSecret = process.env.CRON_SECRET;
fetch("https://api.cron-job.org/jobs", {
  method: "PUT",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    job: {
      title: "capital-flow-tracker: weekly learning synthesis",
      url: "https://capital-flow-tracker.vercel.app/api/cron/learning-synthesis",
      enabled: true,
      saveResponses: true,
      requestMethod: 0,
      extendedData: { headers: { Authorization: `Bearer ${cronSecret}` } },
      schedule: { timezone: "Asia/Seoul", hours: [23], minutes: [0], mdays: [-1], months: [-1], wdays: [0] },
    },
  }),
}).then(async r => { console.log(r.status); console.log(await r.text()); });
'
```

Expected: HTTP 200과 새 `jobId`가 담긴 JSON. (cron-job.org API 스키마가 이 형태와 다르면,
`console.cron-job.org` 대시보드에서 기존 `news-refresh` 잡을 열어 실제 요청 형식을 확인하고
맞춰 조정한다 — 이 스텝은 참고 문서에도 정확한 스키마가 안 남아있어 실행 시점에 검증 필요.)

- [ ] **Step 6: 수동 1회 트리거로 종단간 검증**

```bash
node -e '
require("dotenv").config();
fetch("https://capital-flow-tracker.vercel.app/api/cron/learning-synthesis", {
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
}).then(async r => { console.log(r.status); console.log(await r.text()); });
'
```

Expected: `{"periodKey":"2026-W...","content":"..."}` — 이번 주 `LearningNote`가 있다면 압축본이
생성됨. 0건이면 `{"skipped":true,...}`.

- [ ] **Step 7: 자가학습 페이지에서 육안 확인**

`https://capital-flow-tracker.vercel.app/correction-process/self-learning` 접속, "이번 주 학습
요약" 섹션에 Step 6에서 만든 내용이 표시되는지 확인.

- [ ] **Step 8: Obsidian 세션 로그·트래커 갱신**

`ObsidianVault/Macroeconomic Analysis/capital-flow-tracker/세션 로그/`에 오늘 날짜 로그 추가,
`문제점 및 보완점/트래커.md`의 "완료된 것"에 이 작업 요약 추가(기존 세션들의 관례).

## Self-Review 메모(작성자용, 실행 태스크 아님)

- 스펙의 7개 구성요소 전부 태스크로 매핑됨: ①distill 4요소(Task 2) ②주간압축(Task 3) ③새 테이블
  (Task 1) ④narrative-learning-context 교체(Task 4) ⑤narrative.ts 문구(Task 5) ⑥크론 라우트
  (Task 6) ⑦자가학습 페이지 섹션(Task 7).
- 플레이스홀더 없음, 각 스텝에 실제 코드 포함.
- 타입 일관성: `fetchRecentLearningContext(): Promise<string | undefined>` 시그니처가 Task 4
  전후로 동일 — `narrative.ts`(Task 5)가 이 함수의 반환 타입 변경 없이 그대로 쓸 수 있음을
  확인함. `synthesizeWeeklyLearning()`의 반환 타입(`{periodKey, content} | null`)은 Task 3에서
  정의하고 Task 6이 그대로 소비.
