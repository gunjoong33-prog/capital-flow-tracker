# 적중률 자기학습/개선 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사이트가 스스로 외부 공식 자료(SEC 13F, BIS, 국내 증권사 컨센서스, Finnhub, 뉴스 인용)를 학습해 옵시디언 지식 베이스를 쌓고, 그 지식으로 종합보고서 서술 품질(인과관계·쉬운 문장)을 높이며, 자가진단으로 발견한 버그는 테스트 통과 시에만 자동으로 고쳐 배포한다.

**Architecture:** 기존 코드베이스 관례를 그대로 따른다 — 외부 소스마다 `src/lib/sources/*.ts`에 `fetch → 정규식/JSON 파싱 → {data, errors} 반환`(절대 throw 안 함, dataroma.ts/dart.ts 패턴), DB 접근은 오케스트레이션 계층(`src/lib/*.ts`)에서만, 새 크론은 기존 `requireCronAuth` + cron-job.org 패턴 재사용. 옵시디언 동기화는 로컬 스크립트가 아니라 **기존** `src/lib/obsidian-export.ts`의 `upsertObsidianFile`(GitHub Contents API 커밋)을 그대로 재사용 — 이미 이 리포지토리에 `obsidian-export/` 폴더 ↔ 로컬 vault mklink 접합 메커니즘이 있다.

**Tech Stack:** Next.js 16 · Prisma 7 · Neon Postgres · Vitest · GitHub Actions · Claude Code(헤드리스, `claude -p`) · 기존 Groq/Mistral 연동

## Global Constraints

- **손대지 않음**: `src/lib/scoring/run.ts`의 `runDailyAnalysis`, `src/lib/pipeline.ts`의 `runDailyPipeline`, `src/lib/scoring/pure.ts`의 `scoreStep1~scoreStep8`·`WEIGHTS`·`decisionFromScore`. 이 목록은 `src/lib/protected-files.ts`에 코드 상수로 박아두고 자동수정 파이프라인이 이 파일들을 건드리면 즉시 실패 처리한다(Task 10).
- **테스트 통과 없이 자동배포 금지** — `npm test` + `npx tsc --noEmit` 둘 다 통과해야만 자동 커밋·병합·배포.
- **하루 자동배포 1회 상한** — `AutoFixLog`에서 오늘 날짜의 `deployed: true` 건수를 세어 초과 시 진단만 하고 수정 시도 자체를 건너뛴다.
- **킬스위치** — `AUTO_FIX_ENABLED=false`면 자가진단이 이상을 발견해도 자동수정 트리거를 걸지 않고 Discord 알림만 보낸다.
- **모든 신규 DB 접근 코드는 CI(`.github/workflows/test.yml`, 시크릿 없음)에서 안 도는 테스트에 끌려 들어가면 안 됨** — 순수 로직은 DB import 없는 모듈로 분리(기존 `news-events.ts`/`scoring/pure.ts`/`bigtech-direction.ts` 패턴).
- **기존 소스 모듈 테스트 관례**: `vi.stubGlobal("fetch", fetchMock)`으로 전역 fetch를 모킹하고 `fetchX()` 함수 자체를 직접 테스트(별도 pure.ts 분리 없음) — `src/lib/sources/dart.test.ts` 패턴 그대로.
- **커밋 메시지·PR 제목은 한국어** — 이 리포지토리의 기존 커밋 스타일과 일관되게.

---

### Task 1: DB 스키마 — ExternalConsensus · LearningNote · AutoFixLog

**Files:**
- Modify: `prisma/schema.prisma`
- Create: 마이그레이션(Task 1 Step 3에서 `prisma migrate dev`로 자동 생성)

**Interfaces:**
- Produces: `db.externalConsensus`, `db.learningNote`, `db.autoFixLog` (Prisma Client) — 이후 모든 태스크가 이 모델들을 씀.

- [ ] **Step 1: 스키마에 3개 모델 추가**

`prisma/schema.prisma` 파일 끝(`model MajorEvent { ... }` 다음)에 추가:

```prisma
// 외부 공식 자료(SEC 13F·BIS·국내 증권사 컨센서스·Finnhub·뉴스 인용) 원본 저장.
// sourceType별로 payload 구조가 다르므로 Json으로 보관 — 각 소스 모듈의 반환 타입을 그대로 직렬화한다.
model ExternalConsensus {
  id         String   @id @default(cuid())
  sourceType String   // "13f" | "bis" | "domestic_broker" | "finnhub" | "news_quote"
  sourceName String   // 기관명(예: "Bridgewater Associates", "NH투자증권")
  date       DateTime @db.Date
  payload    Json
  createdAt  DateTime @default(now())

  @@index([sourceType, date])
}

// distill된 해석 방법론 — 옵시디언 "학습" 폴더로 그대로 내보내진다(Task 6).
model LearningNote {
  id         String   @id @default(cuid())
  category   String   // "증권사" | "헤지펀드" | "은행"
  sourceName String
  summary    String   // 한국어 서술 — 지표 해석 방법·사고 과정 요약
  basedOn    Json      // 근거가 된 ExternalConsensus id 배열
  createdAt  DateTime @default(now())

  @@index([category, sourceName])
}

// 자가진단이 발견한 이상과 자동수정 시도 이력 — 성공/실패 무관하게 전부 남긴다(감사 로그).
model AutoFixLog {
  id                   String   @id @default(cuid())
  detectedIssue        String
  attemptedFix         String?
  testsPassed          Boolean?
  protectedFileTouched Boolean?
  deployed             Boolean  @default(false)
  prUrl                String?
  createdAt            DateTime @default(now())

  @@index([createdAt])
}
```

- [ ] **Step 2: 마이그레이션 생성·적용**

Run: `npx prisma migrate dev --name add_self_learning_models`
Expected: `prisma/migrations/<timestamp>_add_self_learning_models/migration.sql` 생성, 로컬 개발 DB에 3개 테이블 생성 성공.

- [ ] **Step 3: Prisma Client 재생성 확인**

Run: `npx prisma generate`
Expected: 에러 없이 종료(`src/generated/prisma`가 이미 gitignore 밖에 있다면 diff 확인, 안에 있다면 그대로 재생성만).

- [ ] **Step 4: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: 자기학습 기능용 DB 스키마 추가(ExternalConsensus·LearningNote·AutoFixLog)"
```

---

### Task 2: SEC EDGAR 13F 헤지펀드 포지셔닝 소스 모듈

**Files:**
- Create: `src/lib/sources/sec-13f.ts`
- Test: `src/lib/sources/sec-13f.test.ts`

**Interfaces:**
- Produces: `fetchHedgeFundHoldings(cik: string): Promise<{ holdings: Holding[]; filingDate: string | null; errors: string[] }>`, `TRACKED_HEDGE_FUNDS: { name: string; cik: string }[]`
- Consumes: 없음(신규)

SEC EDGAR는 각 제출자의 최신 제출 목록을 `https://data.sec.gov/submissions/CIK{10자리 0패딩 CIK}.json`으로 제공하고, 실제 13F 보유내역(Information Table)은 그 제출의 accession number로 `https://www.sec.gov/Archives/edgar/data/{cik}/{accession-no-dashes}/{primary_doc}` 경로의 XML이다. User-Agent 헤더에 연락처를 명시하는 게 SEC 요구사항이다(dataroma.ts의 User-Agent 패턴과 같은 이유).

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/lib/sources/sec-13f.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHedgeFundHoldings, TRACKED_HEDGE_FUNDS } from "./sec-13f";

function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: () => Promise.resolve(body) } as Response;
}
function textResponse(ok: boolean, body: string): Response {
  return { ok, text: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TRACKED_HEDGE_FUNDS", () => {
  it("최소 1개 이상의 추적 대상 헤지펀드를 갖는다", () => {
    expect(TRACKED_HEDGE_FUNDS.length).toBeGreaterThan(0);
    expect(TRACKED_HEDGE_FUNDS[0]).toHaveProperty("cik");
  });
});

describe("fetchHedgeFundHoldings", () => {
  it("최신 13F 제출을 찾아 보유내역을 파싱해 반환한다", async () => {
    const submissionsBody = {
      filings: {
        recent: {
          form: ["13F-HR", "10-K"],
          accessionNumber: ["0001234567-26-000123", "0009999999-26-000001"],
          primaryDocument: ["primary_doc.xml", "other.xml"],
          filingDate: ["2026-08-14", "2026-03-01"],
        },
      },
    };
    const infoTableXml = `<?xml version="1.0"?>
<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <infoTable>
    <nameOfIssuer>APPLE INC</nameOfIssuer>
    <cusip>037833100</cusip>
    <value>150000</value>
    <shrsOrPrnAmt><sshPrnamt>1000</sshPrnamt></shrsOrPrnAmt>
  </infoTable>
  <infoTable>
    <nameOfIssuer>MICROSOFT CORP</nameOfIssuer>
    <cusip>594918104</cusip>
    <value>200000</value>
    <shrsOrPrnAmt><sshPrnamt>500</sshPrnamt></shrsOrPrnAmt>
  </infoTable>
</informationTable>`;

    const fetchMock = vi.fn((url: string) => {
      if (url.includes("data.sec.gov/submissions")) return Promise.resolve(jsonResponse(true, submissionsBody));
      return Promise.resolve(textResponse(true, infoTableXml));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { holdings, filingDate, errors } = await fetchHedgeFundHoldings("0001350694");

    expect(errors).toEqual([]);
    expect(filingDate).toBe("2026-08-14");
    expect(holdings).toEqual([
      { nameOfIssuer: "APPLE INC", cusip: "037833100", valueThousands: 150000, shares: 1000 },
      { nameOfIssuer: "MICROSOFT CORP", cusip: "594918104", valueThousands: 200000, shares: 500 },
    ]);
  });

  it("13F-HR 제출이 하나도 없으면 빈 배열과 에러를 반환한다", async () => {
    const submissionsBody = { filings: { recent: { form: ["10-K"], accessionNumber: ["x"], primaryDocument: ["x.xml"], filingDate: ["2026-01-01"] } } };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(true, submissionsBody))));

    const { holdings, filingDate, errors } = await fetchHedgeFundHoldings("0001350694");

    expect(holdings).toEqual([]);
    expect(filingDate).toBeNull();
    expect(errors.length).toBe(1);
  });

  it("네트워크 실패 시 던지지 않고 errors에 담아 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));

    const { holdings, errors } = await fetchHedgeFundHoldings("0001350694");

    expect(holdings).toEqual([]);
    expect(errors[0]).toContain("network down");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/sources/sec-13f.test.ts`
Expected: FAIL — `Cannot find module './sec-13f'`

- [ ] **Step 3: 구현**

```typescript
// src/lib/sources/sec-13f.ts
// SEC EDGAR 13F(헤지펀드 분기별 포지셔닝) — 완전 무료·공식이지만 API 키 없이 대량 요청하면 막히므로
// User-Agent에 연락처를 명시하는 SEC 요구사항을 지킨다. 최신 13F-HR 제출 하나만 가져온다(분기 대비
// 증감은 오케스트레이션 계층에서 지난 분기 DB 저장값과 비교 — 이 모듈은 단일 시점 스냅샷만 책임진다).
const SEC_USER_AGENT = "capital-flow-tracker personal research contact@example.com";

export interface Holding {
  nameOfIssuer: string;
  cusip: string;
  valueThousands: number;
  shares: number;
}

// Dataroma가 이미 커버하는 "슈퍼 투자자"(버핏류 개인 가치투자자)와 겹치지 않게, 매크로 성향이 강한
// 대형 헤지펀드 위주로 고른다 — CIK는 SEC EDGAR 회사검색에서 확인한 값.
export const TRACKED_HEDGE_FUNDS: { name: string; cik: string }[] = [
  { name: "Bridgewater Associates", cik: "0001350694" },
  { name: "Citadel Advisors", cik: "0001423053" },
  { name: "Millennium Management", cik: "0001273087" },
  { name: "Renaissance Technologies", cik: "0001037389" },
];

function paddedCik(cik: string): string {
  return cik.replace(/^0*/, "").padStart(10, "0");
}

function parseInfoTable(xml: string): Holding[] {
  const blocks = xml.match(/<infoTable>[\s\S]*?<\/infoTable>/g) ?? [];
  const holdings: Holding[] = [];
  for (const block of blocks) {
    const name = block.match(/<nameOfIssuer>([^<]+)<\/nameOfIssuer>/)?.[1]?.trim();
    const cusip = block.match(/<cusip>([^<]+)<\/cusip>/)?.[1]?.trim();
    const value = block.match(/<value>([^<]+)<\/value>/)?.[1];
    const shares = block.match(/<sshPrnamt>([^<]+)<\/sshPrnamt>/)?.[1];
    if (!name || !cusip || value === undefined || shares === undefined) continue;
    holdings.push({ nameOfIssuer: name, cusip, valueThousands: Number(value), shares: Number(shares) });
  }
  return holdings;
}

/** 특정 헤지펀드(CIK)의 최신 13F-HR 보유내역을 가져온다. 실패해도 던지지 않고 errors에 담는다. */
export async function fetchHedgeFundHoldings(
  cik: string
): Promise<{ holdings: Holding[]; filingDate: string | null; errors: string[] }> {
  const errors: string[] = [];
  try {
    const subRes = await fetch(`https://data.sec.gov/submissions/CIK${paddedCik(cik)}.json`, {
      headers: { "User-Agent": SEC_USER_AGENT },
    });
    if (!subRes.ok) throw new Error(`SEC submissions 조회 실패: ${subRes.status}`);
    const sub = (await subRes.json()) as {
      filings: { recent: { form: string[]; accessionNumber: string[]; primaryDocument: string[]; filingDate: string[] } };
    };
    const { form, accessionNumber, primaryDocument, filingDate } = sub.filings.recent;
    const idx = form.findIndex((f) => f === "13F-HR");
    if (idx === -1) {
      errors.push(`SEC: CIK ${cik}에 최근 13F-HR 제출 없음`);
      return { holdings: [], filingDate: null, errors };
    }

    const accessionNoDashes = accessionNumber[idx].replace(/-/g, "");
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDashes}/${primaryDocument[idx]}`;
    const docRes = await fetch(docUrl, { headers: { "User-Agent": SEC_USER_AGENT } });
    if (!docRes.ok) throw new Error(`SEC 13F 문서 조회 실패: ${docRes.status}`);
    const xml = await docRes.text();
    const holdings = parseInfoTable(xml);
    if (holdings.length === 0) errors.push(`SEC: CIK ${cik} 13F 파싱 결과 0건(문서 구조가 바뀌었을 수 있음)`);

    return { holdings, filingDate: filingDate[idx], errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { holdings: [], filingDate: null, errors };
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/sources/sec-13f.test.ts`
Expected: PASS(3/3)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sources/sec-13f.ts src/lib/sources/sec-13f.test.ts
git commit -m "feat: SEC EDGAR 13F 헤지펀드 포지셔닝 소스 모듈 추가"
```

---

### Task 3: BIS SDMX API 소스 모듈

**Files:**
- Create: `src/lib/sources/bis.ts`
- Test: `src/lib/sources/bis.test.ts`

**Interfaces:**
- Produces: `fetchPolicyRates(): Promise<{ rates: PolicyRate[]; errors: string[] }>`

BIS SDMX v2 REST API는 `https://stats.bis.org/api/v2/data/dataflow/BIS/{flow}/{key}?format=csv`로 CSV를 직접 받을 수 있다(JSON보다 파싱이 단순해 이 코드베이스의 "정규식으로 안정적 구조만 파싱" 관례에 더 맞는다). 정책금리 데이터플로우(`WS_CBPOL`)의 미국·유로존·일본 시계열을 가져온다. **구현자 확인 필요**: 실제 배포 전에 이 URL을 브라우저/curl로 한 번 호출해 CSV 컬럼 순서가 아래 파싱과 일치하는지 확인할 것(BIS가 컬럼을 바꿀 수 있음 — dataroma.ts가 이미 "페이지 구조가 바뀌었을 수 있음" 에러 메시지로 이런 상황을 명시적으로 처리하는 것과 같은 이유로, 파싱 실패는 던지지 않고 errors 배열에 담아 조용히 낮은 신뢰도로 처리한다).

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/lib/sources/bis.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPolicyRates } from "./bis";

function textResponse(ok: boolean, body: string): Response {
  return { ok, status: 200, text: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPolicyRates", () => {
  it("CSV를 국가별 정책금리 배열로 파싱한다", async () => {
    const csv = `REF_AREA,TIME_PERIOD,OBS_VALUE\nUS,2026-08,4.50\nXM,2026-08,2.75\nJP,2026-08,0.50\n`;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(textResponse(true, csv))));

    const { rates, errors } = await fetchPolicyRates();

    expect(errors).toEqual([]);
    expect(rates).toEqual([
      { area: "US", period: "2026-08", ratePct: 4.5 },
      { area: "XM", period: "2026-08", ratePct: 2.75 },
      { area: "JP", period: "2026-08", ratePct: 0.5 },
    ]);
  });

  it("빈 CSV(헤더만)면 빈 배열과 에러를 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(textResponse(true, "REF_AREA,TIME_PERIOD,OBS_VALUE\n"))));

    const { rates, errors } = await fetchPolicyRates();

    expect(rates).toEqual([]);
    expect(errors.length).toBe(1);
  });

  it("HTTP 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve("") } as Response)));

    const { rates, errors } = await fetchPolicyRates();

    expect(rates).toEqual([]);
    expect(errors[0]).toContain("503");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/sources/bis.test.ts`
Expected: FAIL — `Cannot find module './bis'`

- [ ] **Step 3: 구현**

```typescript
// src/lib/sources/bis.ts
// BIS(국제결제은행) SDMX REST API — 완전 무료·공식, 중앙은행 공동기관 데이터라 특정 은행 편향이
// 없다. CSV 포맷으로 받아 컬럼을 정규식 없이 split만으로 파싱한다(JSON SDMX 구조가 더 복잡해서
// 이 코드베이스의 "안정적으로 단순한 형식 우선" 관례를 따름).
export interface PolicyRate {
  area: string; // "US" | "XM"(유로존) | "JP" 등 BIS 지역 코드
  period: string; // "YYYY-MM"
  ratePct: number;
}

const BIS_URL = "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/M.US+XM+JP?format=csv&lastNObservations=1";

/** 미국·유로존·일본 정책금리 최신 관측치를 가져온다. */
export async function fetchPolicyRates(): Promise<{ rates: PolicyRate[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch(BIS_URL);
    if (!res.ok) throw new Error(`BIS API 조회 실패: ${res.status}`);
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    const header = lines[0]?.split(",") ?? [];
    const areaIdx = header.indexOf("REF_AREA");
    const periodIdx = header.indexOf("TIME_PERIOD");
    const valueIdx = header.indexOf("OBS_VALUE");
    if (areaIdx === -1 || periodIdx === -1 || valueIdx === -1) {
      errors.push("BIS: CSV 컬럼 구조가 예상과 다름(REF_AREA/TIME_PERIOD/OBS_VALUE 못 찾음)");
      return { rates: [], errors };
    }

    const rates: PolicyRate[] = [];
    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      const area = cols[areaIdx]?.trim();
      const period = cols[periodIdx]?.trim();
      const value = cols[valueIdx]?.trim();
      if (!area || !period || !value) continue;
      rates.push({ area, period, ratePct: Number(value) });
    }
    if (rates.length === 0) errors.push("BIS: 정책금리 파싱 결과 0건(응답 형식이 바뀌었을 수 있음)");

    return { rates, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { rates: [], errors };
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/sources/bis.test.ts`
Expected: PASS(3/3)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sources/bis.ts src/lib/sources/bis.test.ts
git commit -m "feat: BIS 정책금리 SDMX API 소스 모듈 추가"
```

---

### Task 4: Finnhub 애널리스트 등급분포 소스 모듈

**Files:**
- Create: `src/lib/sources/finnhub.ts`
- Test: `src/lib/sources/finnhub.test.ts`

**Interfaces:**
- Produces: `fetchRecommendationTrend(ticker: string): Promise<{ trend: RecommendationTrend | null; errors: string[] }>`
- Consumes: `process.env.FINNHUB_API_KEY`(신규 env var, Task 12에서 `.env.example`에 추가)

Finnhub 무료 티어(`/api/v1/stock/recommendation`)는 매수~매도 등급 분포를 무료로 준다(목표주가는 유료라 다루지 않음).

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/lib/sources/finnhub.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRecommendationTrend } from "./finnhub";

function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, status: 200, json: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchRecommendationTrend", () => {
  it("최신 월 등급분포를 반환한다", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "test-key");
    const body = [
      { period: "2026-08-01", strongBuy: 10, buy: 8, hold: 5, sell: 1, strongSell: 0 },
      { period: "2026-07-01", strongBuy: 9, buy: 8, hold: 6, sell: 1, strongSell: 0 },
    ];
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(true, body))));

    const { trend, errors } = await fetchRecommendationTrend("AAPL");

    expect(errors).toEqual([]);
    expect(trend).toEqual({ period: "2026-08-01", strongBuy: 10, buy: 8, hold: 5, sell: 1, strongSell: 0 });
  });

  it("API 키 없으면 호출 안 하고 에러로 안내한다", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { trend, errors } = await fetchRecommendationTrend("AAPL");

    expect(trend).toBeNull();
    expect(errors[0]).toContain("FINNHUB_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("빈 배열 응답이면 trend null + 에러", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(true, []))));

    const { trend, errors } = await fetchRecommendationTrend("AAPL");

    expect(trend).toBeNull();
    expect(errors.length).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/sources/finnhub.test.ts`
Expected: FAIL — `Cannot find module './finnhub'`

- [ ] **Step 3: 구현**

```typescript
// src/lib/sources/finnhub.ts
// Finnhub 무료 티어 — 매수~매도 등급 분포만 무료(목표주가는 Premium 전용이라 다루지 않는다).
export interface RecommendationTrend {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export async function fetchRecommendationTrend(
  ticker: string
): Promise<{ trend: RecommendationTrend | null; errors: string[] }> {
  const errors: string[] = [];
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    errors.push("Finnhub: FINNHUB_API_KEY 환경변수 없음");
    return { trend: null, errors };
  }
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${apiKey}`);
    if (!res.ok) throw new Error(`Finnhub 조회 실패: ${res.status}`);
    const body = (await res.json()) as RecommendationTrend[];
    if (body.length === 0) {
      errors.push(`Finnhub: ${ticker} 등급분포 데이터 없음`);
      return { trend: null, errors };
    }
    return { trend: body[0], errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { trend: null, errors };
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/sources/finnhub.test.ts`
Expected: PASS(3/3)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sources/finnhub.ts src/lib/sources/finnhub.test.ts
git commit -m "feat: Finnhub 애널리스트 등급분포 소스 모듈 추가"
```

---

### Task 5: 국내 증권사 컨센서스 스크래핑 소스 모듈

**Files:**
- Create: `src/lib/sources/broker-consensus.ts`
- Test: `src/lib/sources/broker-consensus.test.ts`

**Interfaces:**
- Produces: `fetchBrokerConsensus(ticker: string): Promise<{ consensus: BrokerConsensus | null; errors: string[] }>`

네이버금융 종목 페이지(`finance.naver.com/item/main.naver?code={ticker}`)의 투자의견·목표주가 컨센서스 섹션을 파싱한다. API 키 불필요.

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/lib/sources/broker-consensus.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBrokerConsensus } from "./broker-consensus";

function htmlResponse(ok: boolean, body: string): Response {
  return { ok, status: 200, text: () => Promise.resolve(body) } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchBrokerConsensus", () => {
  it("투자의견·목표주가 컨센서스를 파싱한다", async () => {
    const html = `
      <div class="cop_analysis">
        <em class="coment">투자의견</em>
        <span class="num">4.20매수</span>
        <em class="coment">목표주가</em>
        <span class="num">85,000</span>
      </div>`;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(htmlResponse(true, html))));

    const { consensus, errors } = await fetchBrokerConsensus("005930");

    expect(errors).toEqual([]);
    expect(consensus).toEqual({ opinionScore: 4.2, opinionLabel: "매수", targetPrice: 85000 });
  });

  it("컨센서스 섹션이 없으면 null + 에러", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(htmlResponse(true, "<html></html>"))));

    const { consensus, errors } = await fetchBrokerConsensus("005930");

    expect(consensus).toBeNull();
    expect(errors.length).toBe(1);
  });

  it("HTTP 실패 시 던지지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("") } as Response)));

    const { consensus, errors } = await fetchBrokerConsensus("005930");

    expect(consensus).toBeNull();
    expect(errors[0]).toContain("500");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/sources/broker-consensus.test.ts`
Expected: FAIL — `Cannot find module './broker-consensus'`

- [ ] **Step 3: 구현**

```typescript
// src/lib/sources/broker-consensus.ts
// 네이버금융 종목 페이지의 "투자의견·목표주가" 컨센서스 섹션 — 국내 다수 증권사(NH·KB·한투 등)
// 평균치를 무료로 공개한다(API 키 불필요). 페이지 구조가 바뀌면 파싱이 0건이 될 수 있으므로
// dataroma.ts와 같은 원칙으로 던지지 않고 errors에 담는다.
export interface BrokerConsensus {
  opinionScore: number; // 1(매도)~5(강력매수) 척도의 평균
  opinionLabel: string; // "매수" 등 텍스트 라벨
  targetPrice: number;
}

export async function fetchBrokerConsensus(ticker: string): Promise<{ consensus: BrokerConsensus | null; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch(`https://finance.naver.com/item/main.naver?code=${ticker}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (capital-flow-tracker personal use)" },
    });
    if (!res.ok) throw new Error(`네이버금융 조회 실패: ${res.status}`);
    const html = await res.text();

    const opinionMatch = html.match(/투자의견<\/em>\s*<span class="num">([\d.]+)([^<]*)<\/span>/);
    const targetMatch = html.match(/목표주가<\/em>\s*<span class="num">([\d,]+)<\/span>/);
    if (!opinionMatch || !targetMatch) {
      errors.push(`네이버금융: ${ticker} 컨센서스 섹션 못 찾음(페이지 구조가 바뀌었을 수 있음)`);
      return { consensus: null, errors };
    }

    return {
      consensus: {
        opinionScore: Number(opinionMatch[1]),
        opinionLabel: opinionMatch[2].trim(),
        targetPrice: Number(targetMatch[1].replace(/,/g, "")),
      },
      errors,
    };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { consensus: null, errors };
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/sources/broker-consensus.test.ts`
Expected: PASS(3/3)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sources/broker-consensus.ts src/lib/sources/broker-consensus.test.ts
git commit -m "feat: 국내 증권사 컨센서스(네이버금융) 소스 모듈 추가"
```

---

### Task 6: 외부 컨센서스 오케스트레이션 + 주간 크론

**Files:**
- Create: `src/lib/external-consensus.ts`
- Create: `src/app/api/cron/external-consensus/route.ts`
- Test: `src/lib/external-consensus.test.ts`

**Interfaces:**
- Consumes: Task 2~5의 `fetchHedgeFundHoldings`, `fetchPolicyRates`, `fetchRecommendationTrend`, `fetchBrokerConsensus`; `TRACKED_HEDGE_FUNDS`
- Produces: `collectExternalConsensus(tickers: string[]): Promise<{ saved: number; errors: string[] }>` — DB에 `ExternalConsensus` 행 저장

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/lib/external-consensus.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { externalConsensus: { create: vi.fn().mockResolvedValue({}) } } }));
vi.mock("@/lib/sources/sec-13f", () => ({
  TRACKED_HEDGE_FUNDS: [{ name: "Bridgewater Associates", cik: "0001350694" }],
  fetchHedgeFundHoldings: vi.fn().mockResolvedValue({ holdings: [{ nameOfIssuer: "APPLE INC", cusip: "x", valueThousands: 1, shares: 1 }], filingDate: "2026-08-14", errors: [] }),
}));
vi.mock("@/lib/sources/bis", () => ({
  fetchPolicyRates: vi.fn().mockResolvedValue({ rates: [{ area: "US", period: "2026-08", ratePct: 4.5 }], errors: [] }),
}));
vi.mock("@/lib/sources/finnhub", () => ({
  fetchRecommendationTrend: vi.fn().mockResolvedValue({ trend: { period: "2026-08-01", strongBuy: 1, buy: 1, hold: 1, sell: 0, strongSell: 0 }, errors: [] }),
}));
vi.mock("@/lib/sources/broker-consensus", () => ({
  fetchBrokerConsensus: vi.fn().mockResolvedValue({ consensus: { opinionScore: 4, opinionLabel: "매수", targetPrice: 1000 }, errors: [] }),
}));

import { collectExternalConsensus } from "./external-consensus";
import { db } from "@/lib/db";

describe("collectExternalConsensus", () => {
  it("4개 소스를 전부 조회해 DB에 저장하고 저장 건수를 반환한다", async () => {
    const { saved, errors } = await collectExternalConsensus(["AAPL"]);

    expect(errors).toEqual([]);
    expect(saved).toBe(4); // 13F 1건 + BIS 1건 + Finnhub 1건 + 국내컨센서스 1건
    expect(db.externalConsensus.create).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/external-consensus.test.ts`
Expected: FAIL — `Cannot find module './external-consensus'`

- [ ] **Step 3: 구현**

```typescript
// src/lib/external-consensus.ts
// 4개 외부 소스(13F·BIS·Finnhub·국내 컨센서스)를 모아 ExternalConsensus에 저장하는 오케스트레이션.
// 소스 모듈은 전부 던지지 않고 errors를 반환하므로, 이 계층에서 모든 errors를 하나로 합쳐 호출부에
// 넘긴다(institutional-signals.ts가 이미 하는 패턴과 동일).
import { db } from "@/lib/db";
import { TRACKED_HEDGE_FUNDS, fetchHedgeFundHoldings } from "@/lib/sources/sec-13f";
import { fetchPolicyRates } from "@/lib/sources/bis";
import { fetchRecommendationTrend } from "@/lib/sources/finnhub";
import { fetchBrokerConsensus } from "@/lib/sources/broker-consensus";

export async function collectExternalConsensus(tickers: string[]): Promise<{ saved: number; errors: string[] }> {
  const errors: string[] = [];
  let saved = 0;
  const today = new Date();

  for (const fund of TRACKED_HEDGE_FUNDS) {
    const { holdings, filingDate, errors: fundErrors } = await fetchHedgeFundHoldings(fund.cik);
    errors.push(...fundErrors);
    if (holdings.length > 0) {
      await db.externalConsensus.create({
        data: { sourceType: "13f", sourceName: fund.name, date: filingDate ? new Date(filingDate) : today, payload: holdings },
      });
      saved++;
    }
  }

  const { rates, errors: bisErrors } = await fetchPolicyRates();
  errors.push(...bisErrors);
  if (rates.length > 0) {
    await db.externalConsensus.create({ data: { sourceType: "bis", sourceName: "BIS", date: today, payload: rates } });
    saved++;
  }

  for (const ticker of tickers) {
    const { trend, errors: finnhubErrors } = await fetchRecommendationTrend(ticker);
    errors.push(...finnhubErrors);
    if (trend) {
      await db.externalConsensus.create({ data: { sourceType: "finnhub", sourceName: ticker, date: today, payload: trend } });
      saved++;
    }

    const { consensus, errors: brokerErrors } = await fetchBrokerConsensus(ticker);
    errors.push(...brokerErrors);
    if (consensus) {
      await db.externalConsensus.create({ data: { sourceType: "domestic_broker", sourceName: ticker, date: today, payload: consensus } });
      saved++;
    }
  }

  return { saved, errors };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/external-consensus.test.ts`
Expected: PASS(1/1)

- [ ] **Step 5: 주간 크론 라우트 작성**

```typescript
// src/app/api/cron/external-consensus/route.ts
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { collectExternalConsensus } from "@/lib/external-consensus";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 국내 컨센서스·Finnhub는 종목별로 조회하므로 5단계(자금도착)가 이미 추적하는 빅테크 7 + 지수
// ETF만 우선 추적한다 — 전 종목을 매주 스크래핑하면 느리고 이 기능의 목적(방향성 대조)에도 과함.
const TRACKED_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"];

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const { saved, errors } = await collectExternalConsensus(TRACKED_TICKERS);
  if (errors.length > 0) {
    await sendHealthCheckAlert(`외부 컨센서스 수집 중 ${errors.length}건 실패(저장은 ${saved}건 성공):\n${errors.slice(0, 5).join("\n")}`);
  }
  return NextResponse.json({ saved, errors });
}
```

- [ ] **Step 6: 커밋**

```bash
git add src/lib/external-consensus.ts src/lib/external-consensus.test.ts src/app/api/cron/external-consensus/route.ts
git commit -m "feat: 외부 컨센서스(13F·BIS·Finnhub·국내증권사) 수집 오케스트레이션 + 주간 크론"
```

---

### Task 7: 지식 distill(LearningNote) + 옵시디언 동기화

**Files:**
- Create: `src/lib/learning-distill.ts`
- Create: `src/app/api/cron/learning-distill/route.ts`
- Test: `src/lib/learning-distill.test.ts`

**Interfaces:**
- Consumes: `db.externalConsensus`, `callMistral`(`@/lib/llm-clients`), `upsertObsidianFile`(`@/lib/obsidian-export`)
- Produces: `buildDistillPrompt(records): string`(순수, 테스트 가능), `distillAndSaveLearningNotes(): Promise<{ saved: number; errors: string[] }>`

- [ ] **Step 1: 실패 테스트 작성 — 순수 프롬프트 빌더만 우선**

```typescript
// src/lib/learning-distill.test.ts
import { describe, expect, it } from "vitest";
import { buildDistillPrompt } from "./learning-distill";

describe("buildDistillPrompt", () => {
  it("소스명·데이터 개수를 프롬프트에 포함한다", () => {
    const prompt = buildDistillPrompt("Bridgewater Associates", [
      { sourceType: "13f", date: new Date("2026-08-14"), payload: { nameOfIssuer: "APPLE INC" } },
    ]);

    expect(prompt).toContain("Bridgewater Associates");
    expect(prompt).toContain("APPLE INC");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/learning-distill.test.ts`
Expected: FAIL — `Cannot find module './learning-distill'`

- [ ] **Step 3: 구현**

```typescript
// src/lib/learning-distill.ts
// ExternalConsensus 누적 데이터에서 "이 기관은 어떤 지표를 어떤 논리로 해석해 이런 결론에
// 도달했는가"를 LLM으로 distill해 LearningNote에 저장 + 옵시디언 "학습" 폴더로 내보낸다.
// 서술 품질이 중요한 작업이라 narrative.ts와 같은 이유로 Mistral을 쓴다(llm-clients.ts 주석 참고).
import { db } from "@/lib/db";
import { callMistral } from "@/lib/llm-clients";
import { upsertObsidianFile } from "@/lib/obsidian-export";

type ConsensusRecord = { sourceType: string; date: Date; payload: unknown };

const CATEGORY_BY_SOURCE_TYPE: Record<string, string> = {
  "13f": "헤지펀드",
  bis: "은행",
  domestic_broker: "증권사",
  finnhub: "증권사",
  news_quote: "은행",
};

export function buildDistillPrompt(sourceName: string, records: ConsensusRecord[]): string {
  return `너는 매크로 리서치 애널리스트다. 아래는 "${sourceName}"의 최근 공개 데이터다.
이 데이터만 근거로, 이 기관이 어떤 지표를 어떤 논리로 해석해 어떤 결론에 도달했는지 한국어 3~5문장으로 요약해라.
데이터에 없는 내용을 지어내지 마라. 존댓말 아닌 평서체로.

데이터:
${JSON.stringify(records, null, 2)}`;
}

/** 최근 7일간 쌓인 ExternalConsensus를 sourceName별로 묶어 distill하고, DB 저장 + 옵시디언 커밋까지 한다. */
export async function distillAndSaveLearningNotes(): Promise<{ saved: number; errors: string[] }> {
  const errors: string[] = [];
  let saved = 0;

  const since = new Date(Date.now() - 7 * 86_400_000);
  const records = await db.externalConsensus.findMany({ where: { date: { gte: since } } });

  const bySource = new Map<string, ConsensusRecord[]>();
  for (const r of records) {
    const list = bySource.get(r.sourceName) ?? [];
    list.push({ sourceType: r.sourceType, date: r.date, payload: r.payload });
    bySource.set(r.sourceName, list);
  }

  const githubToken = process.env.GITHUB_EXPORT_TOKEN;

  for (const [sourceName, sourceRecords] of bySource) {
    const summary = await callMistral(buildDistillPrompt(sourceName, sourceRecords), 1024, 0.3);
    const category = CATEGORY_BY_SOURCE_TYPE[sourceRecords[0].sourceType] ?? "증권사";

    const note = await db.learningNote.create({
      data: { category, sourceName, summary, basedOn: sourceRecords.map((r) => r.date.toISOString()) },
    });
    saved++;

    if (githubToken) {
      const repoPath = `obsidian-export/학습/${category}/${sourceName}.md`;
      const content = `# ${sourceName}\n\n**분류**: ${category}\n**최종 업데이트**: ${note.createdAt.toISOString().slice(0, 10)}\n\n${summary}\n`;
      const { status, detail } = await upsertObsidianFile(repoPath, content, githubToken);
      if (status === "error") errors.push(`옵시디언 커밋 실패(${sourceName}): ${detail ?? "알 수 없는 오류"}`);
    }
  }

  return { saved, errors };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/learning-distill.test.ts`
Expected: PASS(1/1)

- [ ] **Step 5: 주간 크론 라우트**

```typescript
// src/app/api/cron/learning-distill/route.ts
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { distillAndSaveLearningNotes } from "@/lib/learning-distill";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const { saved, errors } = await distillAndSaveLearningNotes();
  if (errors.length > 0) {
    await sendHealthCheckAlert(`학습노트 distill 중 ${errors.length}건 실패(저장은 ${saved}건 성공):\n${errors.slice(0, 5).join("\n")}`);
  }
  return NextResponse.json({ saved, errors });
}
```

**참고(구현자 안내, 코드 아님)**: 로컬 옵시디언 vault에 `obsidian-export/학습` 폴더가 자동 반영되게 하려면, 사용자가 로컬에서 한 번 `mklink /J "옵시디언 vault 경로\학습" "이 리포지토리 경로\obsidian-export\학습"` 접합을 만들어야 한다(기존 "일일 리포트"·"주기별 리포트" 폴더와 같은 방식) — 이건 사용자 로컬 PC 작업이라 이 태스크가 자동으로 할 수 없다. 태스크 완료 보고에 이 안내를 포함할 것.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/learning-distill.ts src/lib/learning-distill.test.ts src/app/api/cron/learning-distill/route.ts
git commit -m "feat: 외부 자료 distill(LearningNote) + 옵시디언 학습 폴더 동기화"
```

---

### Task 8: 리포트 서술 품질 개선(인과관계 + 쉬운 문장 + 자가검수)

**Files:**
- Modify: `src/lib/narrative.ts`
- Modify: `src/lib/narrative.test.ts`(없으면 신규 생성)

**Interfaces:**
- Consumes: `db.learningNote`(LearningNote 컨텍스트 주입용, 신규)
- Produces: `buildDailyNarrativePrompt`(기존 시그니처 유지, 내용만 강화), `generateNarrative`(기존 시그니처 유지 + 자가검수 패스 추가)

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/lib/narrative.test.ts
import { describe, expect, it } from "vitest";
import { buildDailyNarrativePrompt } from "./narrative";

describe("buildDailyNarrativePrompt", () => {
  it("원인-결과-향후 전망 구조를 프롬프트에 명시한다", () => {
    const prompt = buildDailyNarrativePrompt({
      step1: {}, step2: {}, step3: {}, step4: {}, step5: {}, step6: {}, step7: {}, step8: {},
    });

    expect(prompt).toContain("원인");
    expect(prompt).toContain("향후");
    expect(prompt).toContain("쉬운 문장");
  });

  it("learningContext를 넘기면 프롬프트에 포함한다", () => {
    const prompt = buildDailyNarrativePrompt(
      { step1: {}, step2: {}, step3: {}, step4: {}, step5: {}, step6: {}, step7: {}, step8: {} },
      "참고: Bridgewater는 정책금리 방향을 최우선으로 본다."
    );

    expect(prompt).toContain("Bridgewater");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/narrative.test.ts`
Expected: FAIL — "원인"/"향후"/"쉬운 문장" 문자열 부재로 첫 번째 테스트가 FAIL.

- [ ] **Step 3: 구현**

```typescript
// src/lib/narrative.ts
// 정성적 해설(왜 이런 흐름인지 서술) 생성 — 계산은 전부 scoring/pure.ts가 결정론적으로 하고,
// 여기서는 그 결과를 자연스러운 한국어 문장으로 풀어쓰는 것만 담당한다.
//
// 원래 Gemini 무료 티어를 썼으나 하루 20건 요청 한도가 메인 리포트 파이프라인과 공유돼 자주
// 소진됐다 — Mistral(mistral-large-latest, 무료 Experiment 플랜)로 교체. 실측 비교에서 Groq의
// Llama 3.3 70B는 한국어 응답에 한자·일본어 문자가 섞여 나와 제외했고, Mistral이 이 사이트가
// 쓰는 분석적 한국어 문체를 가장 자연스럽게 생성했다(llm-clients.ts 주석 참고).
import { callMistral } from "@/lib/llm-clients";

/**
 * 생성한 해설을 스스로 재검토해 어려운 문장이면 한 번만 다시 쓴다(무한루프 방지로 1회 제한).
 * "비전공자가 읽어도 명쾌해야 한다"는 요구를 생성 프롬프트 지시만으로는 못 지키는 날이 있어서
 * (LLM이 지시를 놓치는 경우) 별도 검수 패스를 둔다 — narrative.ts 자체가 서술 레이어라 안전.
 */
async function selfReviewForPlainLanguage(narrative: string): Promise<string> {
  const reviewPrompt = `아래 글을 비전공자가 한 번 읽고 바로 이해할 수 있는지 검토해라.
전문용어를 괄호로 풀이하는 방식이 아니라, 문장 구조 자체를 쉽게 바꿔야 한다.
이미 충분히 쉬우면 그대로 반환하고, 어려운 부분이 있으면 그 부분만 쉬운 문장으로 다시 써서
전체 글을 반환해라. 다른 설명 없이 최종 글만 출력해라.

원문:
${narrative}`;
  try {
    const reviewed = await callMistral(reviewPrompt, 2048, 0.3);
    return reviewed.trim().length > 0 ? reviewed : narrative;
  } catch {
    return narrative; // 검수 실패해도 원문은 이미 있으니 그대로 쓴다(자가검수는 개선 시도일 뿐, 필수 경로 아님).
  }
}

export async function generateNarrative(prompt: string, maxOutputTokens = 2048): Promise<string> {
  if (!process.env.MISTRAL_API_KEY) {
    return "[해설 생성 안 됨 — MISTRAL_API_KEY 미설정. 숫자·점수는 위 결과 그대로 신뢰 가능]";
  }
  const draft = await callMistral(prompt, maxOutputTokens, 0.4);
  return selfReviewForPlainLanguage(draft);
}

/**
 * 오늘의 체크리스트 결과를 해설 프롬프트로 변환.
 * v2 프롬프트 원칙(모르면 모른다고 쓴다, 숫자는 링크로 확인한 값만) 그대로
 * — 해설도 계산된 값 밖의 내용을 지어내지 않도록 명시적으로 지시한다.
 *
 * 사용자 요구(2026-08-25 자기학습 프로젝트): "지표가 이래서 이랬다" 식 나열이 아니라
 * 원인→결과→향후 자금흐름 전망의 인과관계로, 비전공자가 읽어도 명쾌한 쉬운 문장으로 쓴다.
 * learningContext(선택)는 LearningNote에서 distill된 전문가 해석 방법론 — 있으면 프롬프트에 참고자료로 얹는다.
 */
export function buildDailyNarrativePrompt(
  report: {
    step1: unknown;
    step2: unknown;
    step3: unknown;
    step4: unknown;
    step5: unknown;
    step6: unknown;
    step7: unknown;
    step8: unknown;
  },
  learningContext?: string
): string {
  return `너는 매크로 자본흐름 애널리스트다. 아래는 오늘 계산된 체크리스트 결과(JSON)다.
이 숫자·판정 결과만 근거로 3~5문장짜리 한국어 해설을 써라.

규칙:
- 결과 JSON에 없는 숫자나 사실을 지어내지 마라.
- "지표가 이래서 이랬다" 식 나열이 아니라, 원인 → 결과 → 향후 자금 흐름 전망의 인과관계로 써라.
  ("어떤 지표가 원인이 되어 이런 변화가 있었고, 앞으로 자금이 어디로 흘러갈 것으로 보인다"는 구조)
- 결론(매수/지켜보기/현금비중늘리기)이 왜 나왔는지 핵심 근거 1~2개만 짚어라.
- 비전공자가 한 번 읽고 바로 이해할 수 있도록 쉬운 문장으로 써라. 전문용어를 괄호로 풀이하지 말고,
  문장 구조 자체를 쉽게 써라.
- 과장하지 말고 담백하게 써라. 존댓말 아닌 평서체로.
${learningContext ? `\n참고(전문가 해석 방법론):\n${learningContext}\n` : ""}
결과 JSON:
${JSON.stringify(report, null, 2)}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/narrative.test.ts`
Expected: PASS(2/2)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/narrative.ts src/lib/narrative.test.ts
git commit -m "feat: 리포트 서술을 인과관계·쉬운 문장 구조로 강화 + 자가검수 패스 추가"
```

---

### Task 9: 자가진단 순수 로직(적중률 연속 오적중 패턴 탐지)

**Files:**
- Create: `src/lib/self-diagnosis-pure.ts`
- Test: `src/lib/self-diagnosis-pure.test.ts`

**Interfaces:**
- Produces: `detectDivergence(verdicts): DivergencePattern[]`, `DivergencePattern` 타입
- Consumes: 없음(DB 접근 없는 순수 모듈 — CI에서 시크릿 없이 테스트되어야 함)

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/lib/self-diagnosis-pure.test.ts
import { describe, expect, it } from "vitest";
import { detectDivergence } from "./self-diagnosis-pure";

describe("detectDivergence", () => {
  it("최근 판정이 연속 불일치(hit=false)면서 표본이 최소치 이상이면 괴리로 본다", () => {
    const verdicts = [
      { date: "2026-08-20", hit: false },
      { date: "2026-08-21", hit: false },
      { date: "2026-08-22", hit: false },
      { date: "2026-08-23", hit: false },
    ];

    const patterns = detectDivergence(verdicts);

    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ kind: "consecutive_miss", count: 4 });
  });

  it("표본이 3건 미만이면 판단 보류(과최적화 방지)", () => {
    const verdicts = [
      { date: "2026-08-22", hit: false },
      { date: "2026-08-23", hit: false },
    ];

    expect(detectDivergence(verdicts)).toEqual([]);
  });

  it("hit이 null(채점 불가)인 건 표본에서 제외한다", () => {
    const verdicts = [
      { date: "2026-08-20", hit: null },
      { date: "2026-08-21", hit: false },
      { date: "2026-08-22", hit: false },
      { date: "2026-08-23", hit: false },
    ];

    const patterns = detectDivergence(verdicts);

    expect(patterns[0]).toMatchObject({ count: 3 });
  });

  it("적중이 섞여 있으면 연속 실패로 안 본다", () => {
    const verdicts = [
      { date: "2026-08-20", hit: true },
      { date: "2026-08-21", hit: false },
      { date: "2026-08-22", hit: false },
      { date: "2026-08-23", hit: false },
    ];

    expect(detectDivergence(verdicts)).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/self-diagnosis-pure.test.ts`
Expected: FAIL — `Cannot find module './self-diagnosis-pure'`

- [ ] **Step 3: 구현**

```typescript
// src/lib/self-diagnosis-pure.ts
// 자가진단의 순수 판정 로직 — DB·LLM 호출 없이 verdict 배열만 받아 이상 패턴을 찾는다.
// news-events.ts·scoring/pure.ts와 같은 이유로 DB-free: CI(시크릿 없음)에서 테스트되어야 하고,
// self-diagnosis.ts(오케스트레이션)가 DB에서 읽은 데이터를 여기 넘겨서 판정만 위임한다.
export interface DivergencePattern {
  kind: "consecutive_miss";
  count: number;
  detail: string;
}

const MIN_SAMPLE = 3; // 이보다 적은 표본으로 "패턴"을 주장하면 우연을 규칙으로 오인하는 과최적화 위험

/** 최근 판정 중 채점 가능한(hit !== null) 것만 최신순으로 보고, 연속 실패 구간을 찾는다. */
export function detectDivergence(verdicts: { date: string; hit: boolean | null }[]): DivergencePattern[] {
  const graded = verdicts.filter((v) => v.hit !== null) as { date: string; hit: boolean }[];
  if (graded.length < MIN_SAMPLE) return [];

  let consecutiveMiss = 0;
  for (let i = graded.length - 1; i >= 0; i--) {
    if (graded[i].hit === false) consecutiveMiss++;
    else break;
  }

  if (consecutiveMiss < MIN_SAMPLE) return [];

  return [
    {
      kind: "consecutive_miss",
      count: consecutiveMiss,
      detail: `최근 판정 ${consecutiveMiss}건이 연속으로 실제 가격 변화와 어긋남(${graded[graded.length - consecutiveMiss].date} ~ ${graded[graded.length - 1].date})`,
    },
  ];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/self-diagnosis-pure.test.ts`
Expected: PASS(4/4)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/self-diagnosis-pure.ts src/lib/self-diagnosis-pure.test.ts
git commit -m "feat: 자가진단 순수 로직(연속 오적중 패턴 탐지) 추가"
```

---

### Task 10: 보호 파일 목록 + 자가진단 오케스트레이션 + 일간 크론

**Files:**
- Create: `src/lib/protected-files.ts`
- Create: `src/lib/self-diagnosis.ts`
- Create: `src/app/api/cron/self-diagnosis/route.ts`
- Test: `src/lib/protected-files.test.ts`
- Test: `src/lib/self-diagnosis.test.ts`

**Interfaces:**
- Consumes: `detectDivergence`(Task 9), `db.dailyReport`, `db.autoFixLog`, `computeVerdictOutcomes`(`@/lib/verdict-outcomes`)
- Produces: `PROTECTED_FILES: string[]`, `touchesProtectedFile(changedFiles: string[]): boolean`, `runSelfDiagnosis(): Promise<{ issueDetected: boolean; issueDescription: string | null }>`

- [ ] **Step 1: protected-files 실패 테스트**

```typescript
// src/lib/protected-files.test.ts
import { describe, expect, it } from "vitest";
import { PROTECTED_FILES, touchesProtectedFile } from "./protected-files";

describe("touchesProtectedFile", () => {
  it("보호 목록의 정확한 경로를 건드리면 true", () => {
    expect(touchesProtectedFile(["src/lib/scoring/run.ts"])).toBe(true);
  });

  it("보호 목록에 없는 경로만 건드리면 false", () => {
    expect(touchesProtectedFile(["src/lib/narrative.ts", "src/app/page.tsx"])).toBe(false);
  });

  it("보호 파일 하나라도 섞여 있으면 true(여러 파일 중 하나만 걸려도 차단)", () => {
    expect(touchesProtectedFile(["src/lib/narrative.ts", "src/lib/scoring/pure.ts"])).toBe(true);
  });

  it("PROTECTED_FILES는 run.ts·pipeline.ts·pure.ts를 포함한다", () => {
    expect(PROTECTED_FILES).toContain("src/lib/scoring/run.ts");
    expect(PROTECTED_FILES).toContain("src/lib/pipeline.ts");
    expect(PROTECTED_FILES).toContain("src/lib/scoring/pure.ts");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/protected-files.test.ts`
Expected: FAIL — `Cannot find module './protected-files'`

- [ ] **Step 3: protected-files 구현**

```typescript
// src/lib/protected-files.ts
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
];

export function touchesProtectedFile(changedFiles: string[]): boolean {
  return changedFiles.some((f) => PROTECTED_FILES.includes(f));
}
```

- [ ] **Step 4: protected-files 테스트 통과 확인**

Run: `npx vitest run src/lib/protected-files.test.ts`
Expected: PASS(4/4)

- [ ] **Step 5: self-diagnosis 실패 테스트**

```typescript
// src/lib/self-diagnosis.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    autoFixLog: { count: vi.fn().mockResolvedValue(0) },
    dailyReport: { findMany: vi.fn().mockResolvedValue([
      { date: new Date("2026-08-20"), marketDate: new Date("2026-08-20"), step8: { finalDecision: "매수" } },
      { date: new Date("2026-08-21"), marketDate: new Date("2026-08-21"), step8: { finalDecision: "매수" } },
      { date: new Date("2026-08-22"), marketDate: new Date("2026-08-22"), step8: { finalDecision: "매수" } },
      { date: new Date("2026-08-23"), marketDate: new Date("2026-08-23"), step8: { finalDecision: "매수" } },
    ]) },
  },
}));
vi.mock("@/lib/verdict-outcomes", () => ({
  computeVerdictOutcomes: vi.fn().mockResolvedValue([
    { date: "2026-08-20", marketDate: "2026-08-20", finalDecision: "매수", hitSp500: false, hitKospi: false, sp500ReturnPct: -1, kospiReturnPct: -1, sp500AnchorDate: null, kospiAnchorDate: null },
    { date: "2026-08-21", marketDate: "2026-08-21", finalDecision: "매수", hitSp500: false, hitKospi: false, sp500ReturnPct: -1, kospiReturnPct: -1, sp500AnchorDate: null, kospiAnchorDate: null },
    { date: "2026-08-22", marketDate: "2026-08-22", finalDecision: "매수", hitSp500: false, hitKospi: false, sp500ReturnPct: -1, kospiReturnPct: -1, sp500AnchorDate: null, kospiAnchorDate: null },
    { date: "2026-08-23", marketDate: "2026-08-23", finalDecision: "매수", hitSp500: false, hitKospi: false, sp500ReturnPct: -1, kospiReturnPct: -1, sp500AnchorDate: null, kospiAnchorDate: null },
  ]),
}));

import { runSelfDiagnosis } from "./self-diagnosis";
import { db } from "@/lib/db";

describe("runSelfDiagnosis", () => {
  it("연속 오적중 패턴이 있으면 이상 발견으로 보고한다", async () => {
    const result = await runSelfDiagnosis();

    expect(result.issueDetected).toBe(true);
    expect(result.issueDescription).toContain("연속");
  });

  it("오늘 이미 자동배포 1건이 있으면 이상이 있어도 issueDetected는 false로 보고한다(상한 가드)", async () => {
    vi.mocked(db.autoFixLog.count).mockResolvedValueOnce(1);

    const result = await runSelfDiagnosis();

    expect(result.issueDetected).toBe(false);
  });
});
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `npx vitest run src/lib/self-diagnosis.test.ts`
Expected: FAIL — `Cannot find module './self-diagnosis'`

- [ ] **Step 7: self-diagnosis 구현**

```typescript
// src/lib/self-diagnosis.ts
// 자가진단 오케스트레이션 — DB에서 최근 리포트·적중 데이터를 읽어 detectDivergence(순수 로직)에
// 넘기고, 하루 자동배포 상한(Global Constraints)을 여기서 체크한다.
import { db } from "@/lib/db";
import { computeVerdictOutcomes } from "@/lib/verdict-outcomes";
import { detectDivergence } from "@/lib/self-diagnosis-pure";

const DAILY_AUTO_DEPLOY_LIMIT = 1;

export async function runSelfDiagnosis(): Promise<{ issueDetected: boolean; issueDescription: string | null }> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayDeployCount = await db.autoFixLog.count({ where: { createdAt: { gte: startOfToday }, deployed: true } });

  const recentReports = await db.dailyReport.findMany({ orderBy: { date: "desc" }, take: 30 });
  const verdictInputs = recentReports.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    marketDate: r.marketDate?.toISOString().slice(0, 10) ?? null,
    finalDecision: (r.step8 as unknown as { finalDecision: string }).finalDecision,
  }));
  const outcomes = await computeVerdictOutcomes(verdictInputs);
  const verdicts = outcomes.map((o) => ({ date: o.date, hit: o.hitSp500 }));

  const patterns = detectDivergence(verdicts);
  if (patterns.length === 0) return { issueDetected: false, issueDescription: null };

  if (todayDeployCount >= DAILY_AUTO_DEPLOY_LIMIT) {
    return { issueDetected: false, issueDescription: null }; // 상한 도달 — 이상은 있지만 오늘은 더 안 건드림
  }

  return { issueDetected: true, issueDescription: patterns.map((p) => p.detail).join("; ") };
}
```

- [ ] **Step 8: self-diagnosis 테스트 통과 확인**

Run: `npx vitest run src/lib/self-diagnosis.test.ts`
Expected: PASS(2/2)

- [ ] **Step 9: 일간 크론 라우트 — 이상 발견 시 GitHub repository_dispatch 트리거**

```typescript
// src/app/api/cron/self-diagnosis/route.ts
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { runSelfDiagnosis } from "@/lib/self-diagnosis";
import { db } from "@/lib/db";
import { sendHealthCheckAlert } from "@/lib/discord-alert";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GITHUB_OWNER = "gunjoong33-prog";
const GITHUB_REPO = "capital-flow-tracker";

async function triggerAutoFixWorkflow(issueDescription: string, logId: string): Promise<void> {
  const token = process.env.GITHUB_EXPORT_TOKEN!;
  await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: "auto-fix-request", client_payload: { issueDescription, logId } }),
  });
}

export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  if (process.env.AUTO_FIX_ENABLED === "false") {
    const { issueDetected, issueDescription } = await runSelfDiagnosis();
    if (issueDetected) await sendHealthCheckAlert(`자가진단 이상 발견(킬스위치로 자동수정 비활성 — 사람이 확인 필요): ${issueDescription}`);
    return NextResponse.json({ issueDetected, autoFixTriggered: false });
  }

  const { issueDetected, issueDescription } = await runSelfDiagnosis();
  if (!issueDetected || !issueDescription) return NextResponse.json({ issueDetected: false, autoFixTriggered: false });

  const log = await db.autoFixLog.create({ data: { detectedIssue: issueDescription } });
  if (!process.env.GITHUB_EXPORT_TOKEN) {
    await sendHealthCheckAlert(`자가진단 이상 발견했지만 GITHUB_EXPORT_TOKEN 없어 자동수정 트리거 불가: ${issueDescription}`);
    return NextResponse.json({ issueDetected: true, autoFixTriggered: false });
  }

  await triggerAutoFixWorkflow(issueDescription, log.id);
  return NextResponse.json({ issueDetected: true, autoFixTriggered: true, logId: log.id });
}
```

- [ ] **Step 10: 커밋**

```bash
git add src/lib/protected-files.ts src/lib/protected-files.test.ts src/lib/self-diagnosis.ts src/lib/self-diagnosis.test.ts src/app/api/cron/self-diagnosis/route.ts
git commit -m "feat: 보호파일 가드 + 자가진단 오케스트레이션 + 일간 크론(이상 발견 시 GitHub 트리거)"
```

---

### Task 11: 자동수정 GitHub Actions 워크플로(Claude Code 헤드리스)

**Files:**
- Create: `.github/workflows/auto-fix.yml`
- Create: `scripts/check-protected-files.ts`
- Test: `scripts/check-protected-files.test.ts`

**Interfaces:**
- Consumes: `PROTECTED_FILES`(Task 10)
- Produces: `checkProtectedFiles(changedFiles: string[]): { ok: boolean; violated: string[] }` — 워크플로 스크립트가 CLI로 호출

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// scripts/check-protected-files.test.ts
import { describe, expect, it } from "vitest";
import { checkProtectedFiles } from "./check-protected-files";

describe("checkProtectedFiles", () => {
  it("보호 파일이 없으면 ok: true", () => {
    expect(checkProtectedFiles(["src/lib/narrative.ts"])).toEqual({ ok: true, violated: [] });
  });

  it("보호 파일이 섞여 있으면 ok: false + 위반 목록", () => {
    const result = checkProtectedFiles(["src/lib/narrative.ts", "src/lib/scoring/run.ts"]);
    expect(result.ok).toBe(false);
    expect(result.violated).toEqual(["src/lib/scoring/run.ts"]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run scripts/check-protected-files.test.ts`
Expected: FAIL — `Cannot find module './check-protected-files'`

- [ ] **Step 3: 구현 — CLI로도 실행 가능한 가드 스크립트**

```typescript
// scripts/check-protected-files.ts
// GitHub Actions 워크플로가 `git diff --name-only`로 변경 파일 목록을 얻어 이 스크립트에 넘긴다.
// 보호 파일이 하나라도 섞여 있으면 exit code 1로 워크플로 자체를 실패시킨다(병합 차단).
import { PROTECTED_FILES } from "../src/lib/protected-files";

export function checkProtectedFiles(changedFiles: string[]): { ok: boolean; violated: string[] } {
  const violated = changedFiles.filter((f) => PROTECTED_FILES.includes(f));
  return { ok: violated.length === 0, violated };
}

// `tsx scripts/check-protected-files.ts <changed-file-1> <changed-file-2> ...`로 실행.
// import.meta.url === entry 체크로 테스트 시(vitest import)에는 이 블록이 안 돌게 한다.
if (import.meta.url === `file://${process.argv[1]}`) {
  const changedFiles = process.argv.slice(2);
  const { ok, violated } = checkProtectedFiles(changedFiles);
  if (!ok) {
    console.error(`보호 파일 변경 감지 — 자동수정 중단: ${violated.join(", ")}`);
    process.exit(1);
  }
  console.log("보호 파일 변경 없음 — 통과");
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run scripts/check-protected-files.test.ts`
Expected: PASS(2/2)

- [ ] **Step 5: GitHub Actions 워크플로 작성**

```yaml
# .github/workflows/auto-fix.yml
name: Auto Fix

# self-diagnosis 크론(src/app/api/cron/self-diagnosis)이 이상을 발견하면 repository_dispatch로
# 이 워크플로를 깨운다. Claude Code를 헤드리스로 돌려 진단→수정 시도→테스트까지 하고, 보호파일을
# 안 건드리고 테스트를 통과해야만 master에 병합·배포한다(그 외엔 draft PR로만 남긴다).
on:
  repository_dispatch:
    types: [auto-fix-request]

jobs:
  auto-fix:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci

      - name: 진단 대상 이슈로 브랜치 생성
        run: git checkout -b auto-fix/${{ github.event.client_payload.logId }}

      - name: Claude Code 헤드리스 실행 — 진단→수정 시도
        # ANTHROPIC_API_KEY가 아니라 CLAUDE_CODE_OAUTH_TOKEN을 쓴다 — API 키는 Pro 구독과 무관한
        # 별도 종량제 과금이지만, OAuth 토큰은 사용자의 Pro 구독 크레딧(월 $20치 Agent SDK 크레딧,
        # 2026-06-15부터 포함)에서 차감된다. 발급: `claude setup-token`(로컬에서 1회 실행 후 출력된
        # 토큰을 GitHub Secrets에 CLAUDE_CODE_OAUTH_TOKEN으로 등록).
        env:
          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
        run: |
          npx @anthropic-ai/claude-code -p "다음 이상이 자가진단에서 감지됐다: ${{ github.event.client_payload.issueDescription }}
          원인을 찾아 최소한의 수정을 하라. 다음 파일은 절대 건드리지 마라(회귀 위험 때문에 스코프 제외됨):
          src/lib/scoring/run.ts, src/lib/pipeline.ts, src/lib/scoring/pure.ts
          수정 후 npm test와 npx tsc --noEmit을 직접 실행해 통과를 확인하라." \
            --allowedTools "Read,Edit,Bash(npm test:*),Bash(npx tsc:*),Grep,Glob" \
            --permission-mode acceptEdits

      - name: 보호 파일 가드
        id: guard
        run: |
          CHANGED=$(git diff --name-only master)
          npx tsx scripts/check-protected-files.ts $CHANGED

      - name: 테스트 + 타입체크
        id: verify
        run: |
          npm test
          npx tsc --noEmit

      - name: 통과 — master에 병합·배포
        if: success()
        run: |
          git config user.name "capital-flow-tracker-autofix"
          git config user.email "autofix@users.noreply.github.com"
          git add -A
          git commit -m "fix(auto): ${{ github.event.client_payload.issueDescription }}" || echo "변경 없음"
          git checkout master
          git merge --no-ff auto-fix/${{ github.event.client_payload.logId }} -m "merge: 자동수정 ${{ github.event.client_payload.logId }}"
          git push origin master

      - name: 실패 — draft PR로만 남김
        if: failure()
        run: |
          git config user.name "capital-flow-tracker-autofix"
          git config user.email "autofix@users.noreply.github.com"
          git add -A
          git commit -m "fix(auto, 검증 실패): ${{ github.event.client_payload.issueDescription }}" || echo "변경 없음"
          git push origin auto-fix/${{ github.event.client_payload.logId }}
          gh pr create --draft --title "자동수정 시도(검증 실패, 사람 확인 필요): ${{ github.event.client_payload.issueDescription }}" \
            --body "자가진단이 이상을 발견해 자동수정을 시도했지만 테스트/타입체크 또는 보호파일 가드를 통과하지 못했습니다. 로그: ${{ github.event.client_payload.logId }}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Discord 알림 — 결과 무관 항상 전송
        if: always()
        run: |
          if [ "${{ job.status }}" = "success" ]; then
            MSG="✅ 자동수정 성공·배포됨: ${{ github.event.client_payload.issueDescription }}"
          else
            MSG="⚠️ 자동수정 시도 실패(사람 확인 필요, draft PR 생성됨): ${{ github.event.client_payload.issueDescription }}"
          fi
          curl -s -X POST -H "Content-Type: application/json" \
            -d "{\"content\": \"$MSG\"}" \
            "${{ secrets.DISCORD_WEBHOOK_URL }}"
```

**참고(구현자 안내, 코드 아님)**: 이 워크플로가 동작하려면 GitHub 리포지토리 Settings → Secrets에 `CLAUDE_CODE_OAUTH_TOKEN`(신규 — 사용자가 로컬에서 `claude setup-token` 실행해 발급, Pro 구독 크레딧에서 차감되게 하려면 `ANTHROPIC_API_KEY`가 아니라 반드시 이 토큰을 써야 함)과 `DISCORD_WEBHOOK_URL`(기존 Vercel env와 별도로 GH Actions Secrets에도 등록 필요)을 추가해야 한다. 또한 `dispatches` 이벤트를 쏘는 `GITHUB_EXPORT_TOKEN`(Task 10에서 재사용)이 `repo` 스코프를 갖고 있는지 확인할 것 — Contents API 쓰기 권한만 있고 `repository_dispatch` 권한이 없는 세분화된(fine-grained) PAT라면 새 스코프를 추가하거나 별도 토큰이 필요할 수 있다.

- [ ] **Step 6: 커밋**

```bash
git add .github/workflows/auto-fix.yml scripts/check-protected-files.ts scripts/check-protected-files.test.ts
git commit -m "feat: 자동수정 GitHub Actions 워크플로(Claude Code 헤드리스 + 보호파일 가드 + 테스트게이트)"
```

---

### Task 12: 환경변수 문서화

**Files:**
- Modify: `.env.example`

**Interfaces:**
- 없음(문서 전용 태스크)

- [ ] **Step 1: `.env.example`에 신규 키 추가**

`.env.example`의 `# LLM providers` 섹션 아래에 추가(Vercel/Next.js 앱이 읽는 값만 — `CLAUDE_CODE_OAUTH_TOKEN`은 이 앱이 아니라 GitHub Actions Secrets에 별도 등록하는 값이라 여기 안 들어간다):

```
# Finnhub(애널리스트 등급분포, 무료 티어)
FINNHUB_API_KEY=

# GitHub Contents API(옵시디언 동기화) + repository_dispatch(자동수정 트리거) 겸용.
# repo 스코프의 PAT 필요 — 세분화된 토큰이면 Contents 쓰기 + Actions 트리거 권한 둘 다 확인.
GITHUB_EXPORT_TOKEN=

# false로 설정하면 자가진단이 이상을 발견해도 자동수정을 트리거하지 않고 알림만 보낸다(킬스위치).
AUTO_FIX_ENABLED=
```

**참고(구현자 안내, 코드 아님)**: `CLAUDE_CODE_OAUTH_TOKEN`(Task 11에서 씀)은 Vercel env가 아니라 GitHub 리포지토리 Settings → Secrets에 등록한다 — 로컬에서 `claude setup-token` 실행 후 출력된 토큰을 그대로 등록.

- [ ] **Step 2: 커밋**

```bash
git add .env.example
git commit -m "docs: 자기학습 기능 신규 환경변수(.env.example) 문서화"
```

---

## Self-Review 결과(계획 작성자 기록)

- **스펙 커버리지**: 설계 문서의 3대 구성요소(외부데이터+지식베이스 → Task 1~7, 리포트품질 → Task 8, 자율수정배포 → Task 9~11) 전부 태스크로 매핑됨. 신규 DB 스키마(Task 1), 안전장치(보호파일 Task 10~11, 상한 Task 10, 킬스위치 Task 10, 감사로그 Task 10) 전부 커버.
- **기존 인프라 재사용으로 설계보다 단순해진 부분**: 옵시디언 동기화는 설계 문서가 제안한 "로컬 실행 내보내기 스크립트" 대신, 코드베이스에 이미 있는 `upsertObsidianFile`(GitHub Contents API 커밋 → 로컬 mklink 접합)을 그대로 재사용하도록 Task 7에서 변경 — 같은 요구사항(옵시디언 반영)을 더 적은 코드로, 자동으로(수동 스크립트 실행 불필요) 달성. 자동수정 실행 환경도 설계 문서의 "Vercel Sandbox 같은 격리 환경"을 GitHub Actions 러너로 구체화(이미 `test.yml`이 쓰는 인프라라 신규 의존성 없음).
- **위험 구간**: Task 11(GitHub Actions 워크플로)이 실제로 `claude-code` CLI를 CI 러너에서 정확히 어떤 플래그로 호출하는지는 Anthropic 쪽 CLI 버전에 따라 달라질 수 있어, 구현자가 최신 `@anthropic-ai/claude-code` 문서로 `--allowedTools`·`--permission-mode` 플래그명을 배포 직전에 재확인해야 한다(플레이스홀더가 아니라 실제 동작하는 값을 넣었지만, 외부 CLI 버전 변경 가능성을 구현자 안내로 명시).
