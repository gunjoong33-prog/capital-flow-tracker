# 데일리 리포트·옵시디언 업로드 실패 즉시 알림 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 데일리 리포트 파이프라인 전체 실패, 그리고 옵시디언 09:30 안전망 크론 최종 실패를 즉시(push) 감지해 Discord로 진단 정보와 함께 알린다.

**Architecture:** 기존 `src/lib/discord-alert.ts`의 `sendHealthCheckAlert`(자체 실패는 삼키는 마지막 보루 알림 함수)를 재사용해, 실패가 발생하는 그 요청 안에서 즉시 호출한다. 새 인프라·새 의존성 없음 — 기존 크론 라우트 2곳의 catch/에러 분기에 알림 호출만 추가하고, 진단 정보가 버려지던 지점(`upsertObsidianFile`)만 반환 타입을 넓힌다.

**Tech Stack:** Next.js API Route(TypeScript), 기존 `discord-alert.ts` 웹훅 함수 재사용. 새 패키지 없음.

## Global Constraints

- Discord 메시지 1건 2000자 제한 — 실패 목록은 최대 5건만 본문에 담고 초과분은 "외 N건 더"로 요약한다(스펙 3번).
- 옵시디언 1차 시도(같은 요청 내 `exportDailyReportNow`) 실패는 알림 대상 아님 — 09:30 안전망 크론이 실패했을 때만 알린다(스펙 "커버 범위" 표).
- `sendHealthCheckAlert`는 내부에서 이미 자기 실패를 삼킨다 — 호출부에서 추가 try/catch 불필요, 그냥 `await`만 하면 된다.
- `upsertObsidianFile`의 호출부는 2곳이다(2026-08-22 재확인, Task 1 실행 직전 발견 — 최초 조사 때 놓침): `src/app/api/cron/obsidian-export/route.ts`와 같은 파일 안의 `exportDailyReportNow`(133-139번 줄). 둘 다 Task 1에서 같이 고친다.
- 이 프로젝트는 웹훅/크론 라우트에 vitest를 안 쓴다(기존 관례) — 검증은 `tsc --noEmit` 타입체크 + 배포 후 수동 트리거로 한다(스펙 "테스트 계획").

---

### Task 1: `upsertObsidianFile` 반환 타입에 실패 원인(detail) 추가

**Files:**
- Modify: `src/lib/obsidian-export.ts:99-124`

**Interfaces:**
- Produces: `upsertObsidianFile(repoPath: string, content: string, token: string): Promise<{ status: "created" | "updated" | "unchanged" | "error"; detail?: string }>` — Task 2가 이 반환 타입을 그대로 소비한다.

- [ ] **Step 1: 함수 시그니처와 각 return을 새 객체 형태로 바꾼다**

`src/lib/obsidian-export.ts`의 기존 코드:

```ts
export async function upsertObsidianFile(repoPath: string, content: string, token: string): Promise<"created" | "updated" | "unchanged" | "error"> {
  const encodedPath = repoPath.split("/").map(encodeURIComponent).join("/");
  const contentBase64 = Buffer.from(content, "utf8").toString("base64");

  const getRes = await githubRequest(`${encodedPath}?ref=${GITHUB_BRANCH}`, token);
  let sha: string | undefined;
  if (getRes.ok) {
    const existing = (await getRes.json()) as { sha: string; content: string };
    const existingContent = Buffer.from(existing.content, "base64").toString("utf8");
    if (existingContent === content) return "unchanged";
    sha = existing.sha;
  } else if (getRes.status !== 404) {
    return "error";
  }

  const putRes = await githubRequest(encodedPath, token, {
    method: "PUT",
    body: JSON.stringify({
      message: `옵시디언 export: ${repoPath}`,
      content: contentBase64,
      branch: GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  return putRes.ok ? (sha ? "updated" : "created") : "error";
}
```

다음으로 교체한다:

```ts
export type UpsertResult = { status: "created" | "updated" | "unchanged" | "error"; detail?: string };

export async function upsertObsidianFile(repoPath: string, content: string, token: string): Promise<UpsertResult> {
  const encodedPath = repoPath.split("/").map(encodeURIComponent).join("/");
  const contentBase64 = Buffer.from(content, "utf8").toString("base64");

  const getRes = await githubRequest(`${encodedPath}?ref=${GITHUB_BRANCH}`, token);
  let sha: string | undefined;
  if (getRes.ok) {
    const existing = (await getRes.json()) as { sha: string; content: string };
    const existingContent = Buffer.from(existing.content, "base64").toString("utf8");
    if (existingContent === content) return { status: "unchanged" };
    sha = existing.sha;
  } else if (getRes.status !== 404) {
    return { status: "error", detail: `GET ${getRes.status}: ${(await getRes.text()).slice(0, 200)}` };
  }

  const putRes = await githubRequest(encodedPath, token, {
    method: "PUT",
    body: JSON.stringify({
      message: `옵시디언 export: ${repoPath}`,
      content: contentBase64,
      branch: GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!putRes.ok) {
    return { status: "error", detail: `PUT ${putRes.status}: ${(await putRes.text()).slice(0, 200)}` };
  }
  return { status: sha ? "updated" : "created" };
}
```

- [ ] **Step 2: 같은 파일 안의 두 번째 호출부(`exportDailyReportNow`)도 새 반환 타입에 맞게 고친다**

현재 코드(133-139번 줄):

```ts
export async function exportDailyReportNow(row: DailyReport): Promise<void> {
  const token = process.env.GITHUB_EXPORT_TOKEN;
  if (!token) throw new Error("GITHUB_EXPORT_TOKEN 환경변수 없음");
  const repoPath = `obsidian-export/일일 리포트/${dailyReportFileName(row)}`;
  const status = await upsertObsidianFile(repoPath, buildDailyReportMarkdown(row), token);
  if (status === "error") throw new Error(`GitHub 커밋 실패: ${repoPath}`);
}
```

다음으로 교체(고치지 않으면 `status`가 객체가 돼 `status === "error"`가 항상 거짓이 되고, 진짜
실패를 영원히 못 잡는 새 버그가 생긴다 — Task 1 실행 직전 리뷰에서 발견):

```ts
export async function exportDailyReportNow(row: DailyReport): Promise<void> {
  const token = process.env.GITHUB_EXPORT_TOKEN;
  if (!token) throw new Error("GITHUB_EXPORT_TOKEN 환경변수 없음");
  const repoPath = `obsidian-export/일일 리포트/${dailyReportFileName(row)}`;
  const { status, detail } = await upsertObsidianFile(repoPath, buildDailyReportMarkdown(row), token);
  if (status === "error") throw new Error(`GitHub 커밋 실패: ${repoPath}${detail ? ` (${detail})` : ""}`);
}
```

- [ ] **Step 3: 타입체크로 이 파일 자체는 통과하되, 아직 안 고친 호출부(route.ts)에서 에러가 나는지 확인**

Run: `cd "C:\Users\김건중\capital-flow-tracker" && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "obsidian-export"`
Expected: `src/app/api/cron/obsidian-export/route.ts`에서 타입 불일치 에러 여러 건(아직 Task 2를 안 했으므로 정상) — `src/lib/obsidian-export.ts` 자체는 에러 없어야 한다.

- [ ] **Step 4: 커밋**

```bash
cd "C:\Users\김건중\capital-flow-tracker"
git add src/lib/obsidian-export.ts
git commit -m "refactor: upsertObsidianFile이 실패 원인(HTTP 상태·응답 본문)도 반환하도록 확장"
```

---

### Task 2: 옵시디언 안전망 크론 — 실패 시 진단 정보 포함해 즉시 Discord 알림

**Files:**
- Modify: `src/app/api/cron/obsidian-export/route.ts` (전체 74줄)

**Interfaces:**
- Consumes: `upsertObsidianFile(repoPath, content, token): Promise<{ status: "created"|"updated"|"unchanged"|"error"; detail?: string }>` (Task 1), `sendHealthCheckAlert(message: string): Promise<void>` (기존, `src/lib/discord-alert.ts`)

- [ ] **Step 1: 현재 전체 파일**

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildDailyReportMarkdown, buildPeriodReportMarkdown, dailyReportFileName, periodReportFileName, upsertObsidianFile } from "@/lib/obsidian-export";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function upsertFile(repoPath: string, content: string): Promise<"created" | "updated" | "unchanged" | "error"> {
  const token = process.env.GITHUB_EXPORT_TOKEN!;
  return upsertObsidianFile(repoPath, content, token);
}

const DEFAULT_DAILY_LOOKBACK_DAYS = 60;
const DEFAULT_PERIOD_LOOKBACK_COUNT = 12;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;
  if (!process.env.GITHUB_EXPORT_TOKEN) {
    return NextResponse.json({ error: "GITHUB_EXPORT_TOKEN 환경변수 없음" }, { status: 500 });
  }
  const full = new URL(request.url).searchParams.get("full") === "1";

  const results: Record<string, string> = {};
  const errors: string[] = [];

  const dailyRows = await db.dailyReport.findMany({
    orderBy: { date: "asc" },
    ...(full ? {} : { where: { date: { gte: new Date(Date.now() - DEFAULT_DAILY_LOOKBACK_DAYS * 86_400_000) } } }),
  });
  for (const row of dailyRows) {
    const repoPath = `obsidian-export/일일 리포트/${dailyReportFileName(row)}`;
    const status = await upsertFile(repoPath, buildDailyReportMarkdown(row));
    results[repoPath] = status;
    if (status === "error") errors.push(repoPath);
  }

  const periodRows = await db.periodReport.findMany({
    orderBy: { periodStart: "desc" },
    ...(full ? {} : { take: DEFAULT_PERIOD_LOOKBACK_COUNT }),
  });
  for (const row of periodRows) {
    const repoPath = `obsidian-export/주기별 리포트/${periodReportFileName(row)}`;
    const status = await upsertFile(repoPath, buildPeriodReportMarkdown(row));
    results[repoPath] = status;
    if (status === "error") errors.push(repoPath);
  }

  const summary = { created: 0, updated: 0, unchanged: 0, error: 0 };
  for (const status of Object.values(results)) summary[status as keyof typeof summary]++;

  return NextResponse.json({ summary, errors, results });
}
```

- [ ] **Step 2: 전체를 아래 내용으로 교체**

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildDailyReportMarkdown, buildPeriodReportMarkdown, dailyReportFileName, periodReportFileName, upsertObsidianFile, type UpsertResult } from "@/lib/obsidian-export";
import { requireCronAuth } from "@/lib/cron-auth";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function upsertFile(repoPath: string, content: string): Promise<UpsertResult> {
  const token = process.env.GITHUB_EXPORT_TOKEN!;
  return upsertObsidianFile(repoPath, content, token);
}

const DEFAULT_DAILY_LOOKBACK_DAYS = 60;
const DEFAULT_PERIOD_LOOKBACK_COUNT = 12;

// Discord 메시지 2000자 제한 고려 — 실패 목록은 최대 5건만 본문에 담고 나머지는 건수로 요약한다.
function formatErrorAlert(errorDetails: { path: string; detail: string }[]): string {
  const shown = errorDetails.slice(0, 5).map((e) => `- ${e.path}: ${e.detail}`).join("\n");
  const rest = errorDetails.length > 5 ? `\n외 ${errorDetails.length - 5}건 더` : "";
  return `옵시디언 안전망 크론에서 ${errorDetails.length}건 실패:\n${shown}${rest}`;
}

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;
  if (!process.env.GITHUB_EXPORT_TOKEN) {
    const message = "GITHUB_EXPORT_TOKEN 환경변수 없음";
    await sendHealthCheckAlert(`옵시디언 안전망 크론 실행 불가: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const full = new URL(request.url).searchParams.get("full") === "1";

  const results: Record<string, string> = {};
  const errorDetails: { path: string; detail: string }[] = [];

  const dailyRows = await db.dailyReport.findMany({
    orderBy: { date: "asc" },
    ...(full ? {} : { where: { date: { gte: new Date(Date.now() - DEFAULT_DAILY_LOOKBACK_DAYS * 86_400_000) } } }),
  });
  for (const row of dailyRows) {
    const repoPath = `obsidian-export/일일 리포트/${dailyReportFileName(row)}`;
    const { status, detail } = await upsertFile(repoPath, buildDailyReportMarkdown(row));
    results[repoPath] = status;
    if (status === "error") errorDetails.push({ path: repoPath, detail: detail ?? "알 수 없는 오류" });
  }

  const periodRows = await db.periodReport.findMany({
    orderBy: { periodStart: "desc" },
    ...(full ? {} : { take: DEFAULT_PERIOD_LOOKBACK_COUNT }),
  });
  for (const row of periodRows) {
    const repoPath = `obsidian-export/주기별 리포트/${periodReportFileName(row)}`;
    const { status, detail } = await upsertFile(repoPath, buildPeriodReportMarkdown(row));
    results[repoPath] = status;
    if (status === "error") errorDetails.push({ path: repoPath, detail: detail ?? "알 수 없는 오류" });
  }

  const summary = { created: 0, updated: 0, unchanged: 0, error: 0 };
  for (const status of Object.values(results)) summary[status as keyof typeof summary]++;

  if (errorDetails.length > 0) {
    await sendHealthCheckAlert(formatErrorAlert(errorDetails));
  }

  return NextResponse.json({ summary, errors: errorDetails, results });
}
```

- [ ] **Step 3: 타입체크 통과 확인**

Run: `cd "C:\Users\김건중\capital-flow-tracker" && npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0, 출력 없음.

- [ ] **Step 4: 커밋**

```bash
cd "C:\Users\김건중\capital-flow-tracker"
git add src/app/api/cron/obsidian-export/route.ts
git commit -m "feat: 옵시디언 안전망 크론 실패 시 진단 정보 포함해 즉시 Discord 알림"
```

---

### Task 3: 파이프라인 — 최종 `sourceErrors`를 DB에 다시 저장(감사 흔적용)

**Files:**
- Modify: `src/lib/pipeline.ts:429` 근처(현재 `return { date: today, ... }` 직전)

**Interfaces:**
- Consumes: 함수 내부 스코프에 이미 있는 `db`, `today`(string), `sourceErrors`(배열). `asJson`(370번 줄)은 `if(isRepeatMarketDay)` 블록 안에서만 유효해 이 위치에선 못 씀 — Task 3 실행 중 타입체크로 발견, 새 블록 안에 `const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;`을 다시 선언해서 해결(1줄, 새 import 불필요, `Prisma` 타입은 이미 파일 상단에서 import돼 있음).

- [ ] **Step 1: 현재 코드(429~450번 줄 부근)**

```ts
  let periodReportsGenerated: string[] = [];
  try {
    const due = await generatePeriodReportsIfDue(new Date(today));
    periodReportsGenerated = due.filter((d) => d.generated).map((d) => d.type);
    for (const d of due.filter((x) => x.generated)) {
      revalidatePath(`/reports/${d.type}`);
    }
  } catch (err) {
    sourceErrors.push({ source: "주기별리포트", error: err instanceof Error ? err.message : String(err) });
  }

  return {
    date: today,
    metricsSaved,
    sourceErrors,
    narrative,
    finalDecision,
    macroTrendScore,
    notionWriteCount,
    periodReportsGenerated,
  };
}
```

- [ ] **Step 2: `return` 직전에 최종 저장 블록 추가**

```ts
  let periodReportsGenerated: string[] = [];
  try {
    const due = await generatePeriodReportsIfDue(new Date(today));
    periodReportsGenerated = due.filter((d) => d.generated).map((d) => d.type);
    for (const d of due.filter((x) => x.generated)) {
      revalidatePath(`/reports/${d.type}`);
    }
  } catch (err) {
    sourceErrors.push({ source: "주기별리포트", error: err instanceof Error ? err.message : String(err) });
  }

  // 위 377번 줄의 upsert 이후(옵시디언export·Discord알림·Notion·주기별리포트) push된 sourceErrors는
  // 지금까지 DB에 한 번도 다시 반영되지 않아 health-check가 절대 못 봤다(2026-08-22 감사로 확인) —
  // 감사 흔적용으로 최종 상태를 한 번 더 저장한다. 알림 트리거는 이 update가 아니라 각 실패 지점의
  // 즉시 알림(daily/route.ts, obsidian-export/route.ts)이 담당하므로, 이 update 자체가 실패해도
  // 조용히 넘어간다(리포트 저장은 이미 끝난 상태라 파이프라인을 막을 이유가 없다).
  try {
    await db.dailyReport.update({
      where: { date: new Date(today) },
      data: { dataCompleteness: asJson({ sourceErrors }) },
    });
  } catch {
    // DB 순단 등으로 이 마지막 저장까지 실패하면, 위에서 이미 시도한 즉시 알림 경로만 남는다.
  }

  return {
    date: today,
    metricsSaved,
    sourceErrors,
    narrative,
    finalDecision,
    macroTrendScore,
    notionWriteCount,
    periodReportsGenerated,
  };
}
```

- [ ] **Step 3: 타입체크 통과 확인**

Run: `cd "C:\Users\김건중\capital-flow-tracker" && npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0, 출력 없음.

- [ ] **Step 4: 커밋**

```bash
cd "C:\Users\김건중\capital-flow-tracker"
git add src/lib/pipeline.ts
git commit -m "fix: 파이프라인 후반부 sourceErrors가 DB에 반영 안 되던 버그 수정"
```

---

### Task 4: 데일리 파이프라인 전체 실패 시 즉시 Discord 알림

**Files:**
- Modify: `src/app/api/cron/daily/route.ts` (전체 25줄)

**Interfaces:**
- Consumes: `sendHealthCheckAlert(message: string): Promise<void>` (기존, `src/lib/discord-alert.ts`)

- [ ] **Step 1: 현재 전체 파일**

```ts
import { NextResponse } from "next/server";
import { runDailyPipeline } from "@/lib/pipeline";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await runDailyPipeline();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: catch 블록에 즉시 알림 추가**

```ts
import { NextResponse } from "next/server";
import { runDailyPipeline } from "@/lib/pipeline";
import { requireCronAuth } from "@/lib/cron-auth";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await runDailyPipeline();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendHealthCheckAlert(`데일리 파이프라인 전체 실패: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: 타입체크 통과 확인**

Run: `cd "C:\Users\김건중\capital-flow-tracker" && npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0, 출력 없음.

- [ ] **Step 4: 커밋**

```bash
cd "C:\Users\김건중\capital-flow-tracker"
git add src/app/api/cron/daily/route.ts
git commit -m "feat: 데일리 파이프라인 전체 실패 시 즉시 Discord 알림"
```

---

### Task 5: 배포 후 수동 검증 (스펙 "테스트 계획" 그대로)

**Files:** 없음(Vercel 환경변수·수동 HTTP 요청만)

- [ ] **Step 1: Task 1~4 푸시 후 Vercel 배포 완료 확인**

Vercel 대시보드 또는 `vercel ls`로 최신 배포가 이 커밋들을 포함해 성공했는지 확인한다.

- [ ] **Step 2: `GITHUB_EXPORT_TOKEN`을 Vercel 환경변수에서 임시로 잘못된 값(예: `invalid-token-test`)으로 바꾸고 재배포**

- [ ] **Step 3: 옵시디언 안전망 크론을 수동으로 호출해 강제로 실패시킨다**

Run(CRON_SECRET은 `.env`의 `CRON_SECRET` 값 사용, `requireCronAuth`가 요구하는 헤더 형식은 `src/lib/cron-auth.ts` 확인):
`curl -H "Authorization: Bearer $CRON_SECRET" https://capital-flow-tracker.vercel.app/api/cron/obsidian-export`
Expected: JSON 응답에 `errors` 배열이 채워져 있음.

- [ ] **Step 4: Discord 채널에 실패 알림이 실제로 도착했는지 확인**

기대 메시지 형태: `옵시디언 안전망 크론에서 N건 실패:\n- obsidian-export/일일 리포트/....md: PUT 401: ...`

- [ ] **Step 5: `GITHUB_EXPORT_TOKEN`을 원래 값으로 복구하고 재배포, 옵시디언 안전망 크론 재호출로 정상(에러 없음) 확인**

---

## Self-Review Notes

- **스펙 커버리지**: 스펙의 1(버그 수정)→Task 3, 2(데일리 실패 알림)→Task 4, 3(옵시디언 실패+진단 정보)→Task 1·2, 테스트 계획→Task 5. 전부 매칭됨.
- **타입 일관성**: `UpsertResult`(Task 1 생성) 타입명이 Task 2의 import·시그니처와 동일하게 사용됨. `upsertFile` 반환 타입도 Task 1과 맞춤.
- **플레이스홀더 없음**: 모든 스텝에 실제 코드/명령어 포함.
