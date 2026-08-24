# 전체 코드베이스 감사·정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** capital-flow-tracker의 프론트엔드·백엔드·LLM 호출 코드 전체를 감사해 버그·스파게티 코드·죽은 코드를 찾아 안전하게 수정하고, 핵심 채점 엔진(`runDailyAnalysis`/`runDailyPipeline`)은 손대지 않은 채 설명만 정리한 뒤, 전/후 비교를 비전공자용 한글 리포트(Artifact)로 발행한다.

**Architecture:** (1) 자동 스캔 도구로 죽은 코드 후보 추출 → (2) 코드로 재확인 후 삭제, (3) 핵심 엔진은 읽기만 해서 설명 작성, (4) 트래커에 이미 열려있는 `bigtech-reasons.ts` 방향성 모순 버그를 TDD로 수정, (5) 나머지 프론트엔드/백엔드를 영역별로 읽으며 안전한 것만 수정, (6) 각 단계마다 vitest+eslint+tsc로 검증 후 로컬 커밋(push 안 함), (7) 마지막에 전체 발견/수정 내역을 JSON으로 취합해 Artifact HTML 리포트 생성·발행.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Prisma 7 + PostgreSQL(Neon) · Vitest · ESLint 9 · ts-prune · depcheck.

## Global Constraints

- **손대지 않음**: `src/lib/scoring/run.ts`의 `runDailyAnalysis`(815줄~, 총 1599줄 파일)와 `src/lib/pipeline.ts`의 `runDailyPipeline`(59줄~, 총 555줄 파일) — 내부 로직·구조를 바꾸지 않는다. 설명만 작성.
- **채점 결과가 바뀔 수 있는 리팩터 금지** — 순수 표시 문구/코드 정리는 가능하나 점수 산출 로직 자체는 건드리지 않는다.
- **배포 금지** — 모든 변경은 로컬 `git commit`까지만. `git push` 하지 않는다.
- **검증 없는 커밋 금지** — 매 커밋 전 `npm run test`(vitest), `npm run lint`, `npx tsc --noEmit` 세 개 모두 통과해야 한다.
- **오탐 삭제 금지** — 자동 도구가 "미사용"이라 보고해도 실제 코드에서 grep으로 재확인 없이 삭제하지 않는다(동적 import, Next.js가 암묵적으로 로드하는 라우트 파일 등).

---

### Task 1: 자동 감사 도구 설치·실행

**Files:**
- Modify: `package.json` (devDependencies에 `ts-prune`, `depcheck` 임시 추가 — Task 종료 시 제거)
- Create: `docs/superpowers/plans/audit-scan-raw.txt` (스캔 원본 출력, 검토용 — 최종 리포트에는 포함 안 함)

**Interfaces:**
- Consumes: 없음(첫 작업)
- Produces: `audit-scan-raw.txt` — Task 2가 이 파일을 읽어 죽은 코드 후보 목록을 만드는 데 사용.

- [ ] **Step 1: ts-prune·depcheck 임시 설치**

Run: `npm install --no-save ts-prune depcheck`
Expected: 설치 완료, `package.json`은 `--no-save`라 안 바뀜(그래도 Global Constraints상 devDependency 문구는 정리 개념 설명용, 실제로는 `--no-save`로 아예 기록 안 남기는 쪽을 기본으로 한다).

- [ ] **Step 2: ts-prune 실행 (미사용 export)**

Run: `npx ts-prune > docs/superpowers/plans/audit-scan-raw.txt 2>&1`
Expected: 파일 생성됨, 종료 코드와 무관하게 결과 텍스트가 파일에 담김.

- [ ] **Step 3: depcheck 실행 (미사용 패키지) 결과를 같은 파일에 이어붙이기**

Run: `echo "\n=== depcheck ===" >> docs/superpowers/plans/audit-scan-raw.txt && npx depcheck >> docs/superpowers/plans/audit-scan-raw.txt 2>&1`
Expected: depcheck 결과가 파일 끝에 추가됨.

- [ ] **Step 4: eslint 미사용 변수/import 결과도 추가**

Run: `echo "\n=== eslint ===" >> docs/superpowers/plans/audit-scan-raw.txt && npm run lint >> docs/superpowers/plans/audit-scan-raw.txt 2>&1`
Expected: eslint 출력(있다면 미사용 변수·import 경고 포함)이 파일에 추가됨. eslint 자체가 실패(에러)해도 다음 Task에서 참고용으로 쓰므로 괜찮음.

- [ ] **Step 5: 커밋 (스캔 원본만, 코드 변경 없음)**

```bash
git add docs/superpowers/plans/audit-scan-raw.txt
git commit -m "chore: 자동 감사 도구 스캔 결과 기록(ts-prune/depcheck/eslint)"
```

---

### Task 2: 죽은 코드 후보 검증 및 삭제

**Files:**
- Read: `docs/superpowers/plans/audit-scan-raw.txt`
- Modify/Delete: Task 1 스캔 결과에서 실제로 확인된 죽은 코드 파일들(경로는 스캔 결과에 따라 결정 — 예: 미사용 export만 있는 파일 전체, 또는 export 일부)
- Test: `npm run test`, `npx tsc --noEmit`, `npm run build`

**Interfaces:**
- Consumes: `audit-scan-raw.txt`의 ts-prune/depcheck 후보 목록
- Produces: `docs/superpowers/plans/audit-findings.json` — `{file, kind:"dead-code", before, after, reason}[]` 형식. Task 7이 최종 리포트를 만들 때 이 파일을 읽는다. (없으면 빈 배열로 시작해 이후 Task들이 이어서 append.)

- [ ] **Step 1: 후보 목록 정리**

`audit-scan-raw.txt`의 ts-prune 출력에서 나온 각 `파일:줄 exportName`을 하나씩:
```bash
grep -rn "exportName" src/ --include="*.ts" --include="*.tsx"
```
로 재검색해서 그 export를 실제로 import하는 곳이 하나도 없는지 확인한다. `src/app/api/**/route.ts`처럼 Next.js가 프레임워크 규약으로 암묵 호출하는 파일(예: `GET`/`POST` export)은 후보에서 제외한다.

- [ ] **Step 2: 확인된 죽은 코드 삭제**

각 확정 항목에 대해 해당 export(또는 파일 전체가 죽었으면 파일 자체)를 삭제한다.

- [ ] **Step 3: 검증**

Run: `npm run test && npx tsc --noEmit && npm run build`
Expected: 셋 다 오류 없이 통과. 실패하면 해당 삭제를 되돌리고 다음 후보로 넘어간다(그 export는 실제로 쓰이고 있었다는 뜻).

- [ ] **Step 4: `audit-findings.json`에 기록**

각 삭제 건을 아래 형식으로 append (파일 없으면 새로 생성):
```json
{"file":"src/lib/example.ts","kind":"dead-code","before":"export function unused() {...} — 어디서도 안 씀","after":"삭제됨","reason":"ts-prune이 미사용으로 표시, grep으로 재확인함"}
```

- [ ] **Step 5: 임시 도구 제거 + 커밋**

Run: `npm uninstall ts-prune depcheck 2>/dev/null; true`
```bash
git add -A
git commit -m "refactor: 확인된 죽은 코드 정리(ts-prune/depcheck 기반)"
```

---

### Task 3: 핵심 엔진 설명 작성 (코드 변경 없음)

**Files:**
- Read: `src/lib/scoring/run.ts:815-1599` (runDailyAnalysis 전체)
- Read: `src/lib/pipeline.ts:59-555` (runDailyPipeline 전체)
- Modify: `docs/superpowers/plans/audit-findings.json` (엔진 설명 섹션 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `audit-findings.json`에 `"engine_explainers"` 키 — Task 7이 리포트의 "핵심 엔진 설명" 섹션에 그대로 사용.

- [ ] **Step 1: runDailyAnalysis 읽고 요약**

`run.ts`의 `runDailyAnalysis` 함수 전체를 읽고, 무슨 일을 하는지(입력→8단계 점수 계산→저장까지의 흐름), 왜 길고 복잡한지, 손대면 어떤 회귀 위험이 있는지(예: 특정 단계 점수 산출 순서가 바뀌면 과거 리포트와의 일관성이 깨질 수 있음 등 실제 코드에서 확인되는 이유)를 비전공자 문장으로 정리한다.

- [ ] **Step 2: runDailyPipeline 읽고 요약**

`pipeline.ts`의 `runDailyPipeline`도 동일하게: 크론이 매일 호출하는 전체 파이프라인(데이터 수집→분석 호출→저장→알림)에서 이 함수가 맡은 역할, 실패 시 어떤 안전장치가 있는지, 왜 나누기 위험한지.

- [ ] **Step 3: `audit-findings.json`에 저장**

```json
{
  "engine_explainers": [
    {"fn": "runDailyAnalysis", "file": "src/lib/scoring/run.ts:815", "explain_kr": "...", "risk_kr": "..."},
    {"fn": "runDailyPipeline", "file": "src/lib/pipeline.ts:59", "explain_kr": "...", "risk_kr": "..."}
  ]
}
```
(기존 `audit-findings.json` 내용 유지하며 키만 추가/병합)

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/plans/audit-findings.json
git commit -m "docs: 핵심 채점 엔진(runDailyAnalysis/runDailyPipeline) 설명 정리"
```

---

### Task 4: bigtech-reasons.ts 방향성 모순 검증 추가 (TDD)

**Files:**
- Create: `src/lib/bigtech-reasons.test.ts`
- Modify: `src/lib/bigtech-reasons.ts`

**Interfaces:**
- Consumes: 없음 (독립적인 순수 함수 추가)
- Produces: `checkDirectionConsistency(changePct1d: number | null, direction: "up" | "down" | "flat" | undefined): boolean` — export된 순수 함수. 다른 Task는 이 함수를 사용하지 않음(bigtech-reasons.ts 내부에서만 씀).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/bigtech-reasons.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { checkDirectionConsistency } from "./bigtech-reasons";

describe("checkDirectionConsistency", () => {
  it("changePct1d가 null이면 항상 일치로 본다(검증 불가)", () => {
    expect(checkDirectionConsistency(null, "up")).toBe(true);
    expect(checkDirectionConsistency(null, "down")).toBe(true);
  });

  it("실제로 오른 종목인데 원인이 하락 방향이면 불일치", () => {
    expect(checkDirectionConsistency(2.5, "down")).toBe(false);
  });

  it("실제로 내린 종목인데 원인이 상승 방향이면 불일치", () => {
    expect(checkDirectionConsistency(-2.5, "up")).toBe(false);
  });

  it("방향이 실제 등락과 같으면 일치", () => {
    expect(checkDirectionConsistency(2.5, "up")).toBe(true);
    expect(checkDirectionConsistency(-2.5, "down")).toBe(true);
  });

  it("flat 방향은 항상 일치로 본다", () => {
    expect(checkDirectionConsistency(2.5, "flat")).toBe(true);
    expect(checkDirectionConsistency(-2.5, "flat")).toBe(true);
  });

  it("방향 필드가 없으면 검증 안 하고 일치로 본다(LLM이 필드를 안 줬을 때 오탐 방지)", () => {
    expect(checkDirectionConsistency(2.5, undefined)).toBe(true);
  });

  it("0.05%p 이내 미세한 변동은 방향 불문 일치로 본다", () => {
    expect(checkDirectionConsistency(0.02, "down")).toBe(true);
    expect(checkDirectionConsistency(-0.02, "up")).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run src/lib/bigtech-reasons.test.ts`
Expected: FAIL — `checkDirectionConsistency` is not exported from `./bigtech-reasons`.

- [ ] **Step 3: `checkDirectionConsistency` 구현**

`src/lib/bigtech-reasons.ts`의 `change1dFor` 함수 위에 추가:
```typescript
export function checkDirectionConsistency(
  changePct1d: number | null,
  direction: "up" | "down" | "flat" | undefined
): boolean {
  if (changePct1d === null || direction === undefined || direction === "flat") return true;
  if (Math.abs(changePct1d) <= 0.05) return true;
  if (direction === "up" && changePct1d < 0) return false;
  if (direction === "down" && changePct1d > 0) return false;
  return true;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/bigtech-reasons.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 프롬프트에 direction 필드 요청 추가 + 파싱 타입 갱신**

`judgeBigTechReasons` 내부, 기존 JSON 형식 지시문:
```
각 항목에 대해 아래 JSON 배열 형식으로만 답해라. 다른 텍스트는 쓰지 마라:
[{"ticker": "AAPL", "reason": "한국어 1문장"}]
```
를 아래로 교체:
```
각 항목에 대해 아래 JSON 배열 형식으로만 답해라. 다른 텍스트는 쓰지 마라. direction은 원인이 주가를
"올리는 방향"이면 "up", "내리는 방향"이면 "down", 방향성이 없거나 중립적 영향이면 "flat":
[{"ticker": "AAPL", "reason": "한국어 1문장", "direction": "up"}]
```

`extractJsonArray<{ ticker: string; reason: string }>(text)` 호출을
`extractJsonArray<{ ticker: string; reason: string; direction?: "up" | "down" | "flat" }>(text)`로 변경.

- [ ] **Step 6: 파싱 후 방향 검증 적용**

`judgeBigTechReasons`의 결과 조립 부분:
```typescript
const result: Record<string, string> = {};
for (const p of parsed) result[p.ticker] = p.reason;
return result;
```
을 아래로 교체 (changes 배열에서 ticker별 changePct1d를 조회):
```typescript
const changeByTicker = new Map(changes.map((c) => [c.ticker, c.changePct1d]));
const result: Record<string, string> = {};
for (const p of parsed) {
  const consistent = checkDirectionConsistency(changeByTicker.get(p.ticker) ?? null, p.direction);
  result[p.ticker] = consistent ? p.reason : "명확한 원인 확인 안 됨(방향 불일치로 제외)";
}
return result;
```

- [ ] **Step 7: 전체 테스트·타입체크 실행**

Run: `npm run test && npx tsc --noEmit`
Expected: 전부 통과(기존 테스트 포함, bigtech-reasons.test.ts 신규 7개 포함).

- [ ] **Step 8: `audit-findings.json`에 기록**

```json
{"file":"src/lib/bigtech-reasons.ts","kind":"bug","before":"LLM이 방향과 모순되는 원인을 지어내도(예: 하락했는데 '목표주가 상향') 그대로 저장됨","after":"LLM에 direction 필드도 요청해 changePct1d 부호와 비교, 불일치하면 '명확한 원인 확인 안 됨'으로 대체","reason":"트래커.md에 2026-08-14부터 열려있던 이슈(MSFT/AMZN 실사례로 확인된 환각) 수정"}
```

- [ ] **Step 9: 커밋**

```bash
git add src/lib/bigtech-reasons.ts src/lib/bigtech-reasons.test.ts docs/superpowers/plans/audit-findings.json
git commit -m "fix: 빅테크 등락 원인 방향성 모순 검증 추가(트래커 이슈 해결)"
```

---

### Task 5: 프론트엔드 컴포넌트 감사·수정

**Files:**
- Read: `src/components/*.tsx` (전체 15개 파일)
- Read: `src/app/**/*.tsx` (page/layout 파일 전체)
- Modify: 발견된 안전한 버그/스파게티만 (파일은 발견 결과에 따름 — 사전에 알 수 없음)
- Test: `npm run test`, `npx tsc --noEmit`, `npm run lint`

**Interfaces:**
- Consumes: 없음
- Produces: `audit-findings.json`에 `kind:"bug"` 또는 `kind:"spaghetti"` 항목 추가.

- [ ] **Step 1: 컴포넌트별 순회 점검**

`src/components/` 15개 파일을 하나씩 읽으며 아래 기준으로 표시:
- 죽은 props/state, 사용 안 하는 import
- 명백한 버그(조건 반전, null 체크 누락으로 런타임 에러 가능성, 잘못된 의존성 배열)
- 스파게티(중복 로직 3회 이상 반복, 매직 넘버, 과도한 중첩 삼항연산자)
- 채점 결과에 영향 없는 것만 대상(표시/스타일/이벤트 핸들러 수준)

- [ ] **Step 2: `src/app/` 페이지 파일 순회 점검**

같은 기준으로 `src/app/**/page.tsx`, `layout.tsx`, API 라우트가 아닌 페이지 파일들 점검.

- [ ] **Step 3: 안전한 항목만 수정**

발견한 것 중 "고쳐도 화면 동작이 의도대로 유지됨을 코드 읽기로 확신할 수 있는 것"만 수정한다. 애매하면 건드리지 않고 `audit-findings.json`에 `"kind":"skipped"`로 이유와 함께 기록한다.

- [ ] **Step 4: 각 수정 후 검증**

Run: `npm run test && npx tsc --noEmit && npm run lint`
Expected: 통과. 실패하면 해당 수정만 되돌린다.

- [ ] **Step 5: `audit-findings.json`에 항목별 기록 후 커밋**

수정 건마다:
```json
{"file":"src/components/Example.tsx","kind":"bug","before":"...","after":"...","reason":"..."}
```
```bash
git add -A
git commit -m "fix: 프론트엔드 컴포넌트 버그·스파게티 코드 정리"
```

---

### Task 6: 백엔드(API 라우트·lib·sources) 감사·수정

**Files:**
- Read: `src/app/api/**/route.ts` (cron, public, debug 전체)
- Read: `src/lib/*.ts` (scoring/sources 제외 최상위 lib 전체 — Task 4에서 다룬 `bigtech-reasons.ts` 제외)
- Read: `src/lib/sources/*.ts` (13개 소스 파일)
- Modify: 발견된 안전한 버그/스파게티만
- Test: `npm run test`, `npx tsc --noEmit`, `npm run lint`

**Interfaces:**
- Consumes: 없음
- Produces: `audit-findings.json`에 항목 추가.

- [ ] **Step 1: API 라우트 순회 점검**

`src/app/api/cron/*`, `src/app/api/public/*`, `src/app/api/debug/*` 각 `route.ts`를 읽으며: 에러 처리 누락(특히 외부 API 호출 실패를 조용히 삼키는 곳 — Discord 알림에서 이미 발견됐던 `res.ok` 미확인류 패턴이 다른 곳에도 있는지), 인증 체크 누락, 중복 로직 확인.

- [ ] **Step 2: lib 최상위 파일 순회 점검**

`comprehensive-report.ts`, `narrative.ts`, `news-events.ts`, `news-page.ts`, `event-outcomes.ts`, `verdict-outcomes.ts`, `metrics.ts`, `text-format.ts`, `text-similarity.ts` 등을 읽으며 같은 기준(버그/스파게티/죽은 코드 — 단 채점 로직 자체는 손대지 않음).

- [ ] **Step 3: lib/sources 순회 점검**

13개 소스 파일 각각에서 API 호출 실패 처리, 재시도 로직 중복, 하드코딩된 매직 넘버(임계값 등 — 이미 알려진 트래커의 "죽은 소스"인 CBOE·KRX Open API 관련 코드가 아직 남아있다면 표시만 하고 삭제는 그대로 스킵 대상으로 별도 확인).

- [ ] **Step 4: 안전한 항목만 수정 후 검증**

Run: `npm run test && npx tsc --noEmit && npm run lint`
Expected: 통과.

- [ ] **Step 5: `audit-findings.json`에 기록 후 커밋**

```bash
git add -A
git commit -m "fix: 백엔드(API 라우트·lib·sources) 버그·스파게티 코드 정리"
```

---

### Task 7: 최종 전/후 비교 리포트 생성·발행

**Files:**
- Read: `docs/superpowers/plans/audit-findings.json` (Task 2~6이 누적한 전체 발견 내역)
- Create: 스크래치패드에 리포트 생성 스크립트 + HTML (경로는 세션의 scratchpad 디렉토리)

**Interfaces:**
- Consumes: `audit-findings.json`의 전체 배열(dead-code/bug/spaghetti/skipped 항목 + engine_explainers)
- Produces: 발행된 Artifact URL

- [ ] **Step 1: `audit-findings.json` 최종 검증**

Run: `PYTHONIOENCODING=utf-8 python -c "import json; d=json.load(open('docs/superpowers/plans/audit-findings.json',encoding='utf-8')); print(len(d.get('items',[])), 'items')"`
Expected: 항목 수가 0이 아님(Task 2~6에서 최소 1건 이상 발견·수정됐어야 함).

- [ ] **Step 2: 이전 리포트(스킬 트리거 리포트)와 동일한 디자인 시스템으로 HTML 생성**

기존 scratchpad의 `skill_trigger_report.html`을 참고해 같은 색 토큰(IBM Plex Sans/Mono, teal 액센트)으로 새 리포트를 만든다. 섹션: (1) 핵심 엔진 설명(engine_explainers), (2) 전/후 비교 표(파일|문제 종류|고치기 전|고친 후|이유), (3) 요약 통계(발견/수정/스킵 건수), (4) "로컬 커밋까지만 됐고 배포 안 됐다" 안내 + 최신 커밋 해시.

- [ ] **Step 3: Artifact 발행**

`artifact-design` 스킬을 먼저 로드한 뒤 발행한다. favicon은 이전 두 리포트(📡, 🗂️)와 겹치지 않는 이모지 사용.

- [ ] **Step 4: 최종 확인**

`git log --oneline -20`으로 이번 작업에서 만든 커밋들이 전부 로컬에만 있고 origin과의 diff가 있는지(`git status`, `git log origin/master..HEAD`) 확인해 사용자에게 보고할 요약에 포함한다.
