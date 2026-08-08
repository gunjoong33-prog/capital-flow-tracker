# 홈 화면 PPT 슬라이드 카드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 화면(`/`) 히어로 섹션 오른쪽 여백에, 오늘 체크리스트(1~8단계+결론)를 9장짜리 카드뉴스 형식으로 보여주는 캐러셀을 추가한다.

**Architecture:** 숫자·사실은 `src/lib/scoring/ppt-slides.ts`의 순수 함수 `buildPptSlides()`가 결정론적으로 조립하고(`pure.ts`와 같은 계층), 슬라이드당 훅 헤드라인 한 줄만 신규 `src/lib/ppt-headlines.ts`가 Groq로 배치 생성한다(숫자는 프롬프트에 아예 안 줌). `pipeline.ts`가 매일 9시 두 단계를 순서대로 실행해 `DailyReport.details.pptSlides`에 저장하고, `page.tsx`가 최신 리포트를 읽어 신규 클라이언트 컴포넌트 `PptSlideDeck`으로 렌더링한다.

**Tech Stack:** Next.js 15(App Router) · TypeScript · Prisma · Vitest · CSS Modules(사이트 기존 라이트/다크 CSS 변수) · Groq(`openai/gpt-oss-120b`, `bigtech-reasons.ts`와 같은 클라이언트)

## Global Constraints

- 헤더 로고·5개 페이지 네비게이션·라이트/다크 토글 버튼·히어로 텍스트(`hero__eyebrow`/`hero__title`/`hero__desc`)·CTA 버튼(`오늘의 리포트 읽기`/`캘린더 보기`)·환율 카드·CNN 공포탐욕 카드는 내용·클래스·크기 전혀 변경하지 않는다.
- 새 카드의 폭은 `.widgetGrid`(`grid-template-columns: 1.2fr 1fr; gap: 1.25rem`)와 동일한 비율+gap을 히어로 섹션에도 적용해서 CNN 공포탐욕 카드와 자동으로 맞춘다.
- 색상은 전부 `var(--bg-raised)`, `var(--border)`, `var(--ink)`, `var(--ink-dim)`, `var(--ink-faint)`, `var(--accent)`, `var(--accent-strong)`, `var(--pos)`, `var(--neg)`만 사용 — 사이트 라이트/다크 변수(`src/styles/site.module.css`) 재사용, 별도 다크 전용 팔레트 없음.
- 슬라이드 헤드라인 생성 프롬프트에는 원본 숫자를 절대 포함하지 않는다(잘못 옮겨 적을 수 없게).
- 오늘의 리포트/주기별 리포트 페이지 적용, PNG export, 과거 리포트 소급 생성은 이번 범위 밖 — 손대지 않는다.
- 애니메이션은 `width`/`height`/`padding`/`margin` 트랜지션 대신 `transform`을 쓴다(레이아웃 스래싱 방지).

---

### Task 1: `PptSlide` 타입 정의 + `buildPptSlides()` 순수 함수

**Files:**
- Modify: `src/lib/scoring/types.ts` (파일 끝에 타입 추가)
- Create: `src/lib/scoring/ppt-slides.ts`
- Create: `src/lib/scoring/ppt-slides.test.ts`

**Interfaces:**
- Consumes: `pure.ts`의 `WEIGHTS`, `TOTAL_WEIGHT`(이미 export됨) · `types.ts`의 `Step1Result`~`Step8Result`, `SectorInput`(이미 export됨)
- Produces: `types.ts`의 `PptSlide` 타입, `ppt-slides.ts`의 `buildPptSlides(input: BuildPptSlidesInput): PptSlide[]` — Task 3(`run.ts` 연동)과 Task 6(`PptSlideDeck.tsx`)이 이 타입·함수를 그대로 가져다 쓴다.

- [ ] **Step 1: `types.ts`에 `PptSlide` 타입 추가**

`src/lib/scoring/types.ts` 파일 맨 끝(마지막 줄, `StepDetails` 인터페이스 닫힌 뒤)에 추가:

```ts
// 홈 화면 PPT 슬라이드 카드(9장: 1~8단계 + 종합 결론). 숫자·사실은 ppt-slides.ts가 결정론적으로
// 채우고, headline만 ppt-headlines.ts가 LLM으로 채운다(초기값은 kicker와 동일 — 실패 시 폴백 겸함).
export interface PptSlide {
  step: number; // 1~8, 9(종합 결론)
  kicker: string;
  headline: string;
  body: string;
  visual: PptSlideVisual;
}

export type PptSlideVisual =
  | { type: "stat-pair"; left: PptStat; right: PptStat }
  | { type: "bar-pair"; left: PptBar; right: PptBar }
  | { type: "ratio-bar"; qualifying: number; total: number; label: string }
  | { type: "weight-bars"; rows: { label: string; score: number; weight: number }[] }
  | { type: "none" };

export interface PptStat {
  value: string;
  label: string;
  tone?: "pos" | "neg" | "accent";
}

export interface PptBar {
  value: string;
  label: string;
  heightPct: number; // 0~100
}
```

그리고 `StepDetails` 인터페이스(`export interface StepDetails { ... }`) 안, `forwardSignals?` 필드 바로 아래에 한 줄 추가:

```ts
  pptSlides?: PptSlide[];
```

- [ ] **Step 2: 실패하는 테스트부터 작성**

`src/lib/scoring/ppt-slides.test.ts` 새로 작성:

```ts
import { describe, expect, it } from "vitest";
import { buildPptSlides } from "./ppt-slides";
import type { Step1Result, Step2Result, Step3Result, Step4Result, Step5Result, Step6Result, Step7Result, Step8Result } from "./types";

function baseInput() {
  const step1: Step1Result = { vetoTriggered: true, reason: "테스트 사유" };
  const step2: Step2Result = { overseasScore: 3.3, overseasQualifyingCount: 2, overseasTotalCount: 6, finalScore: 3.3 };
  const step3: Step3Result = { zone: "위험", score: 4.2, warning: null, spreadBp: 192 };
  const step4: Step4Result = { quadrant: "금↑ 실질금리↑", score: 2, note: "", dollarConfirms: false };
  const step5: Step5Result = { gapPp: -2.25, concentrationWarning: false, riskAppetite: "위험선호", score: 3.0, cryptoAlignsWithRisk: null };
  const step6: Step6Result = { qualifying: [], score: 0 };
  const step7: Step7Result = { bothOverheated: false, oneOverheated: true, fearZone: false, positionSizeMultiplier: 1.0 };
  const step8: Step8Result = { macroTrendScore: 2.95, finalDecision: "현금비중늘리기", vetoApplied: true, positionSizePct: null };
  return {
    step1, step2, step3, step4, step5, step6, step7, step8,
    step2Summary: "해외 유동성 지표 2/6개가 우호적 방향입니다.",
    step3Summary: "US10Y-JP10Y 스프레드가 192bp로 위험 구간입니다.",
    step4Summary: "현재 사분면은 금↑ 실질금리↑입니다.",
    step5Summary: "나스닥100·러셀2000 격차 -2.25%p입니다.",
    step6Summary: "5일 수익률 상위 3위이면서 거래량까지 급증한 섹터는 없습니다.",
    step7Summary: "VIX는 14.90로 과열 구간입니다.",
    vix: 14.9,
    fearGreed: 63.7,
    sectors: [
      { name: "방산(SHLD)", return5d: 9.15, volumeRatio: 1.1 },
      { name: "기술서비스(XLK)", return5d: 3.2, volumeRatio: 0.9 },
    ],
    bigTechMovers: [
      { ticker: "TSLA", label: "테슬라", changePct: 2.83, reason: "JPMorgan 목표주가 상향" },
      { ticker: "GOOGL", label: "알파벳", changePct: -0.96, reason: "SpaceX 주가 급락 여파" },
    ],
  };
}

describe("buildPptSlides", () => {
  it("9개 슬라이드를 반환한다(1~8단계 + 종합 결론)", () => {
    const slides = buildPptSlides(baseInput());
    expect(slides).toHaveLength(9);
    expect(slides.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("1번 슬라이드는 거부권 여부와 최종 점수를 stat-pair로 담는다", () => {
    const slides = buildPptSlides(baseInput());
    const s1 = slides[0];
    expect(s1.kicker).toBe("사실 · 오늘의 결론");
    expect(s1.visual).toEqual({
      type: "stat-pair",
      left: { value: "2.95", label: "투자 적합도", tone: "accent" },
      right: { value: "거부권", label: "1단계 발동", tone: "neg" },
    });
  });

  it("2번 슬라이드는 유동성 우호 지표 비율을 ratio-bar로 담는다", () => {
    const slides = buildPptSlides(baseInput());
    expect(slides[1].visual).toEqual({ type: "ratio-bar", qualifying: 2, total: 6, label: "유동성 우호 지표" });
  });

  it("3번 슬라이드는 캐리 스프레드 vs 안전마진 350bp를 bar-pair로 담는다", () => {
    const slides = buildPptSlides(baseInput());
    const visual = slides[2].visual;
    if (visual.type !== "bar-pair") throw new Error("bar-pair 아님");
    expect(visual.left).toEqual({ value: "192bp", label: "현재 스프레드", heightPct: Math.round((192 / 350) * 100) });
    expect(visual.right).toEqual({ value: "350bp", label: "안전 마진", heightPct: 100 });
  });

  it("5번 슬라이드는 최대 상승·하락 빅테크 종목을 stat-pair로 담는다", () => {
    const slides = buildPptSlides(baseInput());
    expect(slides[4].visual).toEqual({
      type: "stat-pair",
      left: { value: "+2.83%", label: "테슬라", tone: "pos" },
      right: { value: "-0.96%", label: "알파벳", tone: "neg" },
    });
  });

  it("6번 슬라이드는 빈 sectors 배열이면 none 비주얼로 안전하게 폴백한다", () => {
    const input = baseInput();
    input.sectors = [];
    const slides = buildPptSlides(input);
    expect(slides[5].visual).toEqual({ type: "none" });
  });

  it("9번(종합 결론) 슬라이드는 최종 점수·결론 배지를 담는다", () => {
    const slides = buildPptSlides(baseInput());
    const s9 = slides[8];
    expect(s9.step).toBe(9);
    expect(s9.kicker).toBe("결론");
    expect(s9.visual).toEqual({
      type: "stat-pair",
      left: { value: "2.95", label: "투자 적합도", tone: "accent" },
      right: { value: "현금비중늘리기", label: "최종 결론" },
    });
  });

  it("headline 초기값은 kicker와 같다(LLM 실패 시 폴백 겸용)", () => {
    const slides = buildPptSlides(baseInput());
    expect(slides[0].headline).toBe(slides[0].kicker);
  });
});
```

- [ ] **Step 3: 테스트 실행해서 실패 확인**

Run: `npx vitest run src/lib/scoring/ppt-slides.test.ts`
Expected: FAIL — `Cannot find module './ppt-slides'` (파일이 아직 없음)

- [ ] **Step 4: `buildPptSlides()` 구현**

`src/lib/scoring/ppt-slides.ts` 새로 작성:

```ts
// 홈 화면 PPT 슬라이드 카드(9장)의 숫자·사실을 결정론적으로 조립한다. pure.ts와 같은 계층 —
// DB·LLM 호출 없이 이미 계산된 step1~8 결과만으로 순수하게 만든다. headline(훅 헤드라인)만
// 이 파일 밖(ppt-headlines.ts)에서 LLM으로 채워진다 — 숫자를 다루는 이 파일은 LLM과 완전히
// 분리해서, 숫자를 잘못 옮겨 적는 부류의 버그가 애초에 발생할 수 없게 한다.
import { WEIGHTS } from "./pure";
import type {
  PptSlide, SectorInput,
  Step1Result, Step2Result, Step3Result, Step4Result, Step5Result, Step6Result, Step7Result, Step8Result,
} from "./types";

export interface BuildPptSlidesInput {
  step1: Step1Result; step2: Step2Result; step3: Step3Result; step4: Step4Result;
  step5: Step5Result; step6: Step6Result; step7: Step7Result; step8: Step8Result;
  step2Summary: string; step3Summary: string; step4Summary: string;
  step5Summary: string; step6Summary: string; step7Summary: string;
  vix: number | null;
  fearGreed: number | null;
  sectors: SectorInput[];
  bigTechMovers: { ticker: string; label: string; changePct: number | null; reason: string }[];
}

/** 여러 줄 요약 문자열(stepNSummary)의 첫 문장만 슬라이드 본문으로 쓴다 — 새 문장을 짓지 않는다. */
function firstLine(summary: string): string {
  return summary.split("\n")[0] ?? summary;
}

function pctLabel(pct: number | null): string {
  if (pct === null) return "확인 못함";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

export function buildPptSlides(input: BuildPptSlidesInput): PptSlide[] {
  const { step1, step2, step3, step4, step5, step6, step7, step8 } = input;

  const slide1: PptSlide = {
    step: 1,
    kicker: "사실 · 오늘의 결론",
    headline: "사실 · 오늘의 결론",
    body: step1.vetoTriggered ? step1.reason : "거부권 발동 없음",
    visual: {
      type: "stat-pair",
      left: { value: step8.macroTrendScore.toFixed(2), label: "투자 적합도", tone: "accent" },
      right: step1.vetoTriggered
        ? { value: "거부권", label: "1단계 발동", tone: "neg" }
        : { value: "통과", label: "1단계 거부권", tone: "pos" },
    },
  };

  const slide2: PptSlide = {
    step: 2,
    kicker: "사실 · 유동성",
    headline: "사실 · 유동성",
    body: firstLine(input.step2Summary),
    visual: { type: "ratio-bar", qualifying: step2.overseasQualifyingCount, total: step2.overseasTotalCount, label: "유동성 우호 지표" },
  };

  const carrySafeMarginBp = 350;
  const slide3: PptSlide = {
    step: 3,
    kicker: "사실 · 캐리 트레이드",
    headline: "사실 · 캐리 트레이드",
    body: firstLine(input.step3Summary),
    visual: {
      type: "bar-pair",
      left: { value: `${step3.spreadBp}bp`, label: "현재 스프레드", heightPct: Math.round(Math.min(100, (step3.spreadBp / carrySafeMarginBp) * 100)) },
      right: { value: `${carrySafeMarginBp}bp`, label: "안전 마진", heightPct: 100 },
    },
  };

  const slide4: PptSlide = {
    step: 4,
    kicker: "사실 · 환율·금·유가",
    headline: "사실 · 환율·금·유가",
    body: firstLine(input.step4Summary),
    visual: {
      type: "stat-pair",
      left: { value: step4.quadrant, label: "사분면" },
      right: { value: `${step4.score}/10`, label: "점수", tone: step4.score >= 5 ? "pos" : "neg" },
    },
  };

  const validMovers = input.bigTechMovers.filter((m) => m.changePct !== null);
  const bestMover = validMovers.length > 0 ? validMovers.reduce((a, b) => (b.changePct! > a.changePct! ? b : a)) : null;
  const worstMover = validMovers.length > 0 ? validMovers.reduce((a, b) => (b.changePct! < a.changePct! ? b : a)) : null;
  const slide5: PptSlide = {
    step: 5,
    kicker: "사실 · 자금 도착",
    headline: "사실 · 자금 도착",
    body: firstLine(input.step5Summary),
    visual:
      bestMover && worstMover
        ? {
            type: "stat-pair",
            left: { value: pctLabel(bestMover.changePct), label: bestMover.label, tone: "pos" },
            right: { value: pctLabel(worstMover.changePct), label: worstMover.label, tone: "neg" },
          }
        : { type: "none" },
  };

  const sortedSectors = [...input.sectors].sort((a, b) => b.return5d - a.return5d);
  const topSector = sortedSectors[0] ?? null;
  const slide6: PptSlide = {
    step: 6,
    kicker: "사실 · 섹터",
    headline: "사실 · 섹터",
    body: firstLine(input.step6Summary),
    visual: topSector
      ? {
          type: "stat-pair",
          left: { value: `${topSector.return5d.toFixed(2)}%`, label: `${topSector.name} (5일 1위)`, tone: "accent" },
          right: { value: `${step6.qualifying.length}개`, label: "충족 섹터" },
        }
      : { type: "none" },
  };

  const slide7: PptSlide = {
    step: 7,
    kicker: "사실 · 심리 필터",
    headline: "사실 · 심리 필터",
    body: firstLine(input.step7Summary),
    visual: {
      type: "stat-pair",
      left: { value: input.vix !== null ? input.vix.toFixed(2) : "확인 못함", label: "VIX" },
      right: { value: input.fearGreed !== null ? input.fearGreed.toFixed(1) : "확인 못함", label: "공포탐욕지수" },
    },
  };

  const slide8: PptSlide = {
    step: 8,
    kicker: "사실 · 최종 결론 계산",
    headline: "사실 · 최종 결론 계산",
    body: step8.vetoApplied ? "거부권 발동으로 한 단계 하향 조정되었습니다." : "거부권은 발동되지 않았습니다.",
    visual: {
      type: "weight-bars",
      rows: [
        { label: "유동성", score: step2.finalScore, weight: WEIGHTS.step2 },
        { label: "캐리 트레이드", score: step3.score, weight: WEIGHTS.step3 },
        { label: "환율·금·유가", score: step4.score, weight: WEIGHTS.step4 },
        { label: "자금 도착", score: step5.score, weight: WEIGHTS.step5 },
        { label: "섹터", score: step6.score, weight: WEIGHTS.step6 },
      ],
    },
  };

  const slide9: PptSlide = {
    step: 9,
    kicker: "결론",
    headline: "결론",
    body: "",
    visual: {
      type: "stat-pair",
      left: { value: step8.macroTrendScore.toFixed(2), label: "투자 적합도", tone: "accent" },
      right: { value: step8.finalDecision, label: "최종 결론" },
    },
  };

  return [slide1, slide2, slide3, slide4, slide5, slide6, slide7, slide8, slide9];
}
```

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `npx vitest run src/lib/scoring/ppt-slides.test.ts`
Expected: PASS — 7개 테스트 전부 통과

- [ ] **Step 6: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/lib/scoring/ppt-slides.ts src/lib/scoring/ppt-slides.test.ts src/lib/scoring/types.ts
git commit -m "feat: PPT 슬라이드 9장 결정론적 조립 로직 추가"
```

---

### Task 2: `run.ts`에 `buildPptSlides()` 연동

**Files:**
- Modify: `src/lib/scoring/run.ts:1345-1404`(step8 계산 직후, `return` 직전)

**Interfaces:**
- Consumes: Task 1의 `buildPptSlides(input: BuildPptSlidesInput): PptSlide[]`(`./ppt-slides`에서 import)
- Produces: `details.pptSlides`(`runDailyAnalysis()`가 반환하는 `details` 객체의 새 필드) — Task 4(`pipeline.ts`)가 이 필드를 읽어 헤드라인을 채운다.

- [ ] **Step 1: import 추가**

`src/lib/scoring/run.ts` 최상단 import 블록(다른 `./` 상대경로 import들 옆)에 추가:

```ts
import { buildPptSlides } from "./ppt-slides";
```

- [ ] **Step 2: `details.forwardSignals` 블록 뒤에 `details.pptSlides` 추가**

`run.ts:1402`(`institutionalDirection: institutionalFlowRow?.value ?? null,\n  };`) 바로 뒤, `return { step1, ..., details };`(1404번째 줄) 바로 앞에 삽입:

```ts

  details.pptSlides = buildPptSlides({
    step1, step2, step3, step4, step5, step6, step7, step8,
    step2Summary: details.step2Summary ?? "",
    step3Summary: details.step3Summary ?? "",
    step4Summary: details.step4Summary ?? "",
    step5Summary: details.step5Summary ?? "",
    step6Summary: details.step6Summary ?? "",
    step7Summary: details.step7Summary ?? "",
    vix,
    fearGreed,
    sectors: manualInputs.sectors,
    bigTechMovers: bigTechMovers.map((m) => ({ ticker: m.ticker, label: m.label, changePct: m.change.changePct, reason: m.reason })),
  });
```

(`vix`, `fearGreed`, `bigTechMovers`는 이미 위쪽(1216~1274번째 줄)에서 선언된 지역 변수를 그대로 재사용 — 새로 조회하지 않는다.)

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음(만약 `bigTechMovers`/`vix`/`fearGreed` 변수명이 실제 파일과 다르면 여기서 에러가 나므로, 에러 메시지의 정확한 변수명으로 맞춰 수정한다)

- [ ] **Step 4: 기존 테스트 스위트 통과 확인**

Run: `npx vitest run`
Expected: 기존 45개 + Task 1의 7개 = 52개 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/scoring/run.ts
git commit -m "feat: runDailyAnalysis가 details.pptSlides를 채우도록 연동"
```

---

### Task 3: 헤드라인 생성 — `src/lib/ppt-headlines.ts`

**Files:**
- Create: `src/lib/ppt-headlines.ts`
- Create: `src/lib/ppt-headlines.test.ts`

**Interfaces:**
- Consumes: `@/lib/llm-clients`의 `callGroq(prompt, options)`, `extractJsonArray<T>(text)`(이미 export됨, `src/lib/llm-clients.ts:56,96`) · `@/lib/scoring/types`의 `PptSlide`
- Produces: `generatePptHeadlines(slides: PptSlide[]): Promise<Record<number, string>>` — 슬라이드 `step` 번호 → 헤드라인 문자열 맵. Task 4(`pipeline.ts`)가 그대로 가져다 쓴다.

- [ ] **Step 1: 실패하는 테스트부터 작성(숫자 검출 폴백 로직만 — LLM 호출은 모킹)**

`src/lib/ppt-headlines.test.ts` 새로 작성:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm-clients", () => ({
  callGroq: vi.fn(),
  extractJsonArray: vi.fn(),
}));

import { callGroq, extractJsonArray } from "@/lib/llm-clients";
import { generatePptHeadlines } from "./ppt-headlines";
import type { PptSlide } from "./scoring/types";

function slide(step: number, kicker: string): PptSlide {
  return { step, kicker, headline: kicker, body: "본문", visual: { type: "none" } };
}

describe("generatePptHeadlines", () => {
  it("정상 응답이면 숫자 없는 헤드라인을 그대로 쓴다", async () => {
    vi.mocked(callGroq).mockResolvedValue("...");
    vi.mocked(extractJsonArray).mockReturnValue([{ step: 1, headline: "숫자보다 뉴스가 이긴 하루" }]);
    const result = await generatePptHeadlines([slide(1, "사실 · 오늘의 결론")]);
    expect(result[1]).toBe("숫자보다 뉴스가 이긴 하루");
  });

  it("헤드라인에 숫자가 섞여 있으면 그 슬라이드만 kicker로 폴백한다", async () => {
    vi.mocked(callGroq).mockResolvedValue("...");
    vi.mocked(extractJsonArray).mockReturnValue([{ step: 1, headline: "148건의 뉴스가 3점을 눌렀다" }]);
    const result = await generatePptHeadlines([slide(1, "사실 · 오늘의 결론")]);
    expect(result[1]).toBe("사실 · 오늘의 결론");
  });

  it("LLM 호출 실패 시 전체 슬라이드가 kicker로 폴백한다", async () => {
    vi.mocked(callGroq).mockRejectedValue(new Error("네트워크 오류"));
    const result = await generatePptHeadlines([slide(1, "사실 · 오늘의 결론"), slide(2, "사실 · 유동성")]);
    expect(result).toEqual({ 1: "사실 · 오늘의 결론", 2: "사실 · 유동성" });
  });

  it("응답 파싱 실패(JSON 배열 아님) 시 전체 슬라이드가 kicker로 폴백한다", async () => {
    vi.mocked(callGroq).mockResolvedValue("이상한 응답");
    vi.mocked(extractJsonArray).mockReturnValue(null);
    const result = await generatePptHeadlines([slide(1, "사실 · 오늘의 결론")]);
    expect(result[1]).toBe("사실 · 오늘의 결론");
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run src/lib/ppt-headlines.test.ts`
Expected: FAIL — `Cannot find module './ppt-headlines'`

- [ ] **Step 3: `generatePptHeadlines()` 구현**

`src/lib/ppt-headlines.ts` 새로 작성:

```ts
// 홈 화면 PPT 슬라이드 카드의 훅 헤드라인만 LLM으로 짓는다(숫자·사실은 ppt-slides.ts가 이미 결정론적
// 으로 확정). bigtech-reasons.ts와 같은 원칙 — 가볍고 빈도 낮은 판단이라 빠른 Groq를 쓰고, 9개
// 슬라이드를 한 프롬프트로 묶어 한 번만 호출한다. 프롬프트에는 kicker·body(둘 다 이미 확정된 사실
// 문장)만 넘기고 원본 숫자는 아예 안 준다 — 숫자를 안 주면 잘못 옮겨 적을 수도 없다. 그래도 혹시
// 모델이 body에 있던 숫자를 헤드라인에 베껴 쓰면(예: "148건의 뉴스가...") 그 슬라이드만 kicker로
// 폴백한다 — 화면에 카드가 아예 안 뜨는 것보단 안전(데이터 정직성 원칙).
import { callGroq, extractJsonArray } from "@/lib/llm-clients";
import type { PptSlide } from "@/lib/scoring/types";

interface HeadlineResponse {
  step: number;
  headline: string;
}

export async function generatePptHeadlines(slides: PptSlide[]): Promise<Record<number, string>> {
  const fallback: Record<number, string> = {};
  for (const s of slides) fallback[s.step] = s.kicker;

  const sections = slides.map((s) => `${s.step}번: ${s.kicker} — ${s.body}`).join("\n");
  const prompt = `너는 경제 매거진의 카드뉴스 헤드라인 카피라이터다. 아래는 오늘 발행할 카드뉴스
9장의 사실 요약이다. 각 장마다 훅이 있는 한국어 헤드라인을 한 줄(15자 내외, 최대 2줄)로 지어라.

*** 절대 규칙: 헤드라인에 숫자를 쓰지 마라(아라비아 숫자, %, bp 등 전부 금지) ***
숫자는 카드의 다른 자리에서 이미 정확히 보여주므로, 헤드라인은 "왜 중요한지"를 숫자 없이 압축하는
역할만 한다. 예시 톤(참고용, 그대로 베끼지 말 것): "스프레드는 위험한데 엔화는 왜 조용한가",
"같은 날, 정반대로 움직인 두 종목", "숫자보다 뉴스가 이긴 하루".
존댓말(합니다체) 쓰지 마라 — 명사구나 짧은 평서형으로 끝내라.

아래 JSON 배열 형식으로만 답해라. 다른 텍스트는 쓰지 마라:
[{"step": 1, "headline": "한국어 헤드라인"}]

카드 목록:
${sections}`;

  let text: string;
  try {
    text = await callGroq(prompt, { maxTokens: 1024, reasoningEffort: "low" });
  } catch {
    return fallback;
  }

  const parsed = extractJsonArray<HeadlineResponse>(text);
  if (!parsed) return fallback;

  const result = { ...fallback };
  for (const item of parsed) {
    if (typeof item.step !== "number" || typeof item.headline !== "string") continue;
    if (!(item.step in result)) continue; // 모르는 step 번호는 무시
    if (/\d/.test(item.headline)) continue; // 숫자 섞이면 폴백(kicker) 유지
    result[item.step] = item.headline;
  }
  return result;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run src/lib/ppt-headlines.test.ts`
Expected: PASS — 4개 테스트 전부 통과

- [ ] **Step 5: 타입 체크 + 전체 테스트**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 에러 없음, 전체 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/ppt-headlines.ts src/lib/ppt-headlines.test.ts
git commit -m "feat: PPT 슬라이드 헤드라인 Groq 배치 생성(숫자 미포함, 폴백 포함)"
```

---

### Task 4: `pipeline.ts` 연동

**Files:**
- Modify: `src/lib/pipeline.ts:270-274`(`generateComprehensiveReport` 호출 바로 뒤)

**Interfaces:**
- Consumes: Task 3의 `generatePptHeadlines(slides: PptSlide[]): Promise<Record<number, string>>`

- [ ] **Step 1: import 추가**

`src/lib/pipeline.ts` 상단, `import { generateComprehensiveReport } from "@/lib/comprehensive-report";`(16번째 줄) 바로 아래에 추가:

```ts
import { generatePptHeadlines } from "@/lib/ppt-headlines";
```

- [ ] **Step 2: 헤드라인 생성 호출 추가**

`src/lib/pipeline.ts:270-273`(아래 블록) 바로 뒤에 이어서 추가:

```ts
    try {
      report.details.comprehensiveReport = await generateComprehensiveReport(report);
    } catch (err) {
      report.details.comprehensiveReport = `[종합 보고서 생성 실패: ${err instanceof Error ? err.message : String(err)}]`;
    }

    if (report.details.pptSlides && report.details.pptSlides.length > 0) {
      const headlines = await generatePptHeadlines(report.details.pptSlides);
      report.details.pptSlides = report.details.pptSlides.map((s) => ({ ...s, headline: headlines[s.step] ?? s.kicker }));
    }
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 전체 테스트 통과 확인**

Run: `npx vitest run`
Expected: 전체 PASS(pipeline.ts 자체는 DB/네트워크 의존이라 유닛 테스트 대상 아님 — 기존 관례와 동일)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/pipeline.ts
git commit -m "feat: 파이프라인이 comprehensiveReport 다음에 PPT 헤드라인도 생성하도록 연동"
```

---

### Task 5: `PptSlideDeck` 컴포넌트

**Files:**
- Create: `src/components/PptSlideDeck.tsx`
- Create: `src/components/PptSlideDeck.module.css`

**Interfaces:**
- Consumes: `@/lib/scoring/types`의 `PptSlide`, `PptSlideVisual`(Task 1에서 정의)
- Produces: `<PptSlideDeck slides={PptSlide[]} />` — Task 6(`page.tsx`)이 그대로 렌더링에 쓴다.

- [ ] **Step 1: 컴포넌트 작성**

`src/components/PptSlideDeck.tsx` 새로 작성:

```tsx
"use client";

import { useState } from "react";
import type { PptSlide, PptSlideVisual } from "@/lib/scoring/types";
import styles from "./PptSlideDeck.module.css";

function toneClass(tone: "pos" | "neg" | "accent" | undefined): string {
  if (tone === "pos") return styles.tonePos;
  if (tone === "neg") return styles.toneNeg;
  if (tone === "accent") return styles.toneAccent;
  return "";
}

function Visual({ visual }: { visual: PptSlideVisual }) {
  if (visual.type === "stat-pair") {
    return (
      <div className={styles.statPair}>
        <div className={styles.stat}>
          <div className={`${styles.statValue} ${toneClass(visual.left.tone)}`}>{visual.left.value}</div>
          <div className={styles.statLabel}>{visual.left.label}</div>
        </div>
        <div className={styles.stat}>
          <div className={`${styles.statValue} ${toneClass(visual.right.tone)}`}>{visual.right.value}</div>
          <div className={styles.statLabel}>{visual.right.label}</div>
        </div>
      </div>
    );
  }
  if (visual.type === "bar-pair") {
    return (
      <div className={styles.barChart}>
        {[visual.left, visual.right].map((bar, i) => (
          <div className={styles.barCol} key={i}>
            <div className={`${styles.barValue} ${i === 0 ? styles.toneAccent : ""}`}>{bar.value}</div>
            <div className={styles.bar} style={{ height: `${Math.max(bar.heightPct, 6)}%`, background: i === 0 ? "var(--accent-strong)" : "var(--border)" }} />
            <div className={styles.barLabel}>{bar.label}</div>
          </div>
        ))}
      </div>
    );
  }
  if (visual.type === "ratio-bar") {
    const pct = visual.total > 0 ? (visual.qualifying / visual.total) * 100 : 0;
    return (
      <div className={styles.ratioWrap}>
        <div className={styles.ratioTrack}>
          <div className={styles.ratioFill} style={{ width: `${pct}%` }} />
        </div>
        <div className={styles.ratioLabel}>
          {visual.label} {visual.qualifying} / {visual.total}
        </div>
      </div>
    );
  }
  if (visual.type === "weight-bars") {
    return (
      <div className={styles.weightBars}>
        {visual.rows.map((row) => (
          <div className={styles.weightRow} key={row.label}>
            <span className={styles.weightLabel}>{row.label}</span>
            <div className={styles.weightTrack}>
              <div className={styles.weightFill} style={{ width: `${Math.min(100, (row.score / 10) * 100)}%` }} />
            </div>
            <span className={styles.weightScore}>{row.score.toFixed(1)}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export function PptSlideDeck({ slides }: { slides: PptSlide[] }) {
  const [i, setI] = useState(0);
  if (slides.length === 0) return null;
  const slide = slides[i];
  const go = (delta: number) => setI((prev) => (prev + delta + slides.length) % slides.length);

  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <span className={styles.kicker}>{slide.kicker}</span>
        <span className={styles.pageLabel}>{i + 1} / {slides.length}</span>
      </div>
      <div className={styles.body}>
        <div>
          <div className={styles.headline}>{slide.headline}</div>
          {slide.body && <div className={styles.sub}>{slide.body}</div>}
        </div>
        <Visual visual={slide.visual} />
      </div>
      <div className={styles.bottom}>
        <div className={styles.dots}>
          {slides.map((s, idx) => (
            <button
              key={s.step}
              type="button"
              aria-label={`${idx + 1}번 슬라이드로 이동`}
              className={`${styles.dot} ${idx === i ? styles.dotActive : ""}`}
              onClick={() => setI(idx)}
            />
          ))}
        </div>
        <div className={styles.nav}>
          <button type="button" aria-label="이전 슬라이드" className={styles.navBtn} onClick={() => go(-1)}>‹</button>
          <button type="button" aria-label="다음 슬라이드" className={styles.navBtn} onClick={() => go(1)}>›</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS 모듈 작성**

`src/components/PptSlideDeck.module.css` 새로 작성:

```css
.card {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-raised);
  padding: 1.1rem 1.25rem 1rem;
  display: flex;
  flex-direction: column;
  min-height: 230px;
}
.top { display: flex; align-items: center; justify-content: space-between; margin-bottom: .8rem; }
.kicker { font-size: .68rem; font-weight: 700; letter-spacing: .03em; color: var(--accent-strong); }
.pageLabel { font-size: .68rem; color: var(--ink-faint); }

.body { display: flex; flex-direction: column; gap: .8rem; flex: 1; justify-content: center; }
.headline {
  font-family: var(--font-sans), sans-serif;
  font-size: 1.02rem; font-weight: 700; line-height: 1.32; color: var(--ink);
  word-break: keep-all; margin: 0 0 .4rem;
}
.sub { font-size: .74rem; color: var(--ink-dim); line-height: 1.5; word-break: keep-all; }

.statPair { display: flex; gap: 8px; }
.stat { flex: 1; text-align: center; border: 1px solid var(--border); border-radius: 10px; padding: .55rem .3rem; }
.statValue { font-size: .98rem; font-weight: 700; color: var(--ink); }
.statLabel { font-size: .6rem; color: var(--ink-faint); margin-top: .2rem; }

.barChart { display: flex; align-items: flex-end; gap: 20px; height: 70px; justify-content: center; margin-top: .4rem; }
.barCol { display: flex; flex-direction: column; align-items: center; gap: 5px; height: 100%; justify-content: flex-end; }
.barValue { font-size: .74rem; font-weight: 700; color: var(--ink); }
.bar { width: 28px; border-radius: 4px 4px 0 0; }
.barLabel { font-size: .62rem; color: var(--ink-faint); text-align: center; }

.ratioWrap { display: flex; flex-direction: column; gap: .4rem; margin-top: .4rem; }
.ratioTrack { height: 8px; border-radius: 999px; background: var(--border); overflow: hidden; }
.ratioFill { height: 100%; background: var(--accent-strong); border-radius: 999px; }
.ratioLabel { font-size: .7rem; color: var(--ink-dim); }

.weightBars { display: flex; flex-direction: column; gap: 6px; margin-top: .3rem; }
.weightRow { display: flex; align-items: center; gap: 6px; font-size: .64rem; color: var(--ink-dim); }
.weightLabel { width: 60px; flex-shrink: 0; }
.weightTrack { flex: 1; height: 5px; background: var(--border); border-radius: 999px; overflow: hidden; }
.weightFill { height: 100%; background: var(--accent-strong); border-radius: 999px; }
.weightScore { width: 26px; text-align: right; flex-shrink: 0; }

.tonePos { color: var(--pos); }
.toneNeg { color: var(--neg); }
.toneAccent { color: var(--accent-strong); }

.bottom { display: flex; align-items: center; justify-content: space-between; margin-top: .9rem; }
.dots { display: flex; gap: 5px; }
.dot { width: 5px; height: 5px; padding: 0; border: none; border-radius: 999px; background: var(--border); cursor: pointer; transform-origin: left center; }
.dotActive { background: var(--accent-strong); width: 14px; }
.nav { display: flex; gap: 6px; }
.navBtn {
  width: 26px; height: 26px; border-radius: 999px; border: 1px solid var(--border); background: transparent;
  color: var(--ink-dim); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 13px;
  padding: 0;
}
.navBtn:hover { border-color: var(--accent-strong); color: var(--accent-strong); }
```

(점 페이지네이션은 `width`를 즉시 전환할 뿐 트랜지션을 걸지 않는다 — 목업 리뷰에서 지적된 레이아웃
스래싱은 애니메이션이 있을 때만 문제이므로, 트랜지션을 아예 빼는 쪽으로 해결했다.)

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/components/PptSlideDeck.tsx src/components/PptSlideDeck.module.css
git commit -m "feat: PptSlideDeck 캐러셀 컴포넌트 추가"
```

---

### Task 6: `page.tsx` 히어로 레이아웃에 연결

**Files:**
- Modify: `src/app/page.tsx:1-10`(import), `:51-120`(`LandingPage` 컴포넌트, 데이터 조회 + hero 마크업)
- Modify: `src/app/page.module.css:5-64`(`.hero` 관련 클래스)

**Interfaces:**
- Consumes: Task 5의 `<PptSlideDeck slides={PptSlide[]} />`, `@/lib/db`의 `db`(이미 프로젝트 전역에서 쓰는 Prisma 클라이언트)

- [ ] **Step 1: `page.tsx`에 최신 리포트 조회 추가**

`src/app/page.tsx` 상단 import 블록에 추가(4번째 줄, `SiteHeader` import 아래):

```ts
import { db } from "@/lib/db";
import { PptSlideDeck } from "@/components/PptSlideDeck";
import type { StepDetails } from "@/lib/scoring/types";
```

`LandingPage` 함수 안, 기존 `Promise.all([...])`(52~58번째 줄) 바로 뒤에 추가:

```ts
  const latestReport = await db.dailyReport.findFirst({ orderBy: { date: "desc" } });
  const pptSlides = (latestReport?.details as unknown as StepDetails | null)?.pptSlides ?? [];
```

- [ ] **Step 2: 히어로 마크업을 그리드로 감싸기**

`src/app/page.tsx`의 `<section className={styles.hero}>...</section>` 블록(101~120번째 줄)을 아래로 교체:

```tsx
        <section className={styles.hero}>
          <div className={styles.heroGrid}>
            <div className={styles.heroLeft}>
              <span className={styles.hero__eyebrow}>매일 아침 9시, 자본이 움직이는 흐름을 점검합니다</span>
              <h1 className={styles.hero__title}>
                데이터로 확인하는
                <br />
                오늘의 자본 흐름
              </h1>
              <p className={styles.hero__desc}>
                <span>뉴스·유동성·환율·자금 흐름을 여덟 개의 단계로 순차 점검합니다.</span>
                <span>감정을 배제한 결정론적 규칙과 실제 시장 데이터로만 판단합니다.</span>
              </p>
              <div className={styles.hero__ctaRow}>
                <Link className={`${styles.btn} ${styles["btn--primary"]}`} href="/report">
                  오늘의 리포트 읽기
                </Link>
                <Link className={`${styles.btn} ${styles["btn--ghost"]}`} href="/calendar">
                  캘린더 보기
                </Link>
              </div>
            </div>
            {pptSlides.length > 0 && (
              <div className={styles.heroRight}>
                <PptSlideDeck slides={pptSlides} />
              </div>
            )}
          </div>
        </section>
```

(내용은 원본 그대로 옮긴 것뿐 — eyebrow·title·desc·ctaRow 텍스트/클래스 하나도 안 바꿨다. `pptSlides`가
비어 있으면(옛 리포트 등) 오른쪽 칸 자체를 안 그려서 왼쪽 칸이 원래처럼 단독으로 보인다.)

- [ ] **Step 3: `page.module.css`에 그리드 클래스 추가**

`src/app/page.module.css`의 `.hero { ... }`(5~8번째 줄) 블록 바로 뒤에 추가:

```css
.heroGrid {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 1.25rem;
  align-items: stretch;
}
@media (max-width: 780px) {
  .heroGrid {
    grid-template-columns: 1fr;
  }
}
.heroLeft {
  padding-bottom: 0.4rem;
}
.heroRight {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
```

(`1.2fr 1fr` + `1.25rem` gap은 `.widgetGrid`(67~76번째 줄)와 정확히 같은 값 — 두 섹션이 물리적으로
다른 grid라도 오른쪽 컬럼 폭이 자동으로 CNN 공포탐욕 카드와 맞는다. 780px 이하 반응형 처리도
`.widgetGrid`와 동일하게 1컬럼으로 무너뜨린다.)

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 5: 전체 테스트 통과 확인**

Run: `npx vitest run`
Expected: 전체 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/app/page.tsx src/app/page.module.css
git commit -m "feat: 홈 화면 히어로 오른쪽에 PPT 슬라이드 카드 배치"
```

---

### Task 7: 리포트 재생성 + 브라우저 검증

**Files:** 없음(코드 변경 없음, 검증만)

**Interfaces:** 없음

- [ ] **Step 1: 오늘 리포트를 `--regen-report`로 재생성해 `pptSlides` 채우기**

Run: `npx tsx scripts/refresh-report.ts $(date +%Y-%m-%d) --regen-report`
Expected: `YYYY-MM-DD 리포트 갱신 완료` 출력, 에러 없음

- [ ] **Step 2: 로컬 개발 서버 재시작**

기존 워크플로우(`[[capital_flow_tracker_workflow]]`) 그대로:

```bash
netstat -ano | grep :3000 | grep LISTENING
```

떠 있는 PID가 있으면 `taskkill //PID <pid> //F`, 그다음:

```bash
rm -rf .next
npm run dev
```

- [ ] **Step 3: Chrome으로 홈 화면 라이트/다크 둘 다 확인**

`http://localhost:3000/`을 열어 스크린샷:
- 히어로 텍스트·버튼이 원래 위치·크기 그대로인지
- 새 카드가 CNN 공포탐욕 카드와 폭이 맞는지
- `‹ ›`로 9장이 전부 정상 렌더링되는지(빈 슬라이드·깨진 레이아웃 없는지)
- 라이트 모드 토글 후 카드 색상이 사이트 라이트 테마와 맞는지
- 환율·CNN 공포탐욕 카드, 헤더 로고·네비게이션·테마 토글이 이전과 동일한지

문제 발견 시 해당 Task로 돌아가 수정 후 이 Task를 다시 수행한다.

- [ ] **Step 4: 배포**

```bash
git push origin master
vercel --prod --yes
curl -s -o /dev/null -w "%{http_code}\n" https://capital-flow-tracker.vercel.app/
```

Expected: `200`

---

## Self-Review 메모(계획 작성자용, 실행 시 참고)

- Task 2에서 `bigTechMovers`/`vix`/`fearGreed` 지역 변수명이 실제 `run.ts`와 다르면(리팩터링 등으로)
  Step 3의 `tsc` 에러 메시지를 보고 정확한 이름으로 맞춰야 한다 — Task 1 작성 시점(2026-08-09)
  기준 `run.ts:1219`(`bigTechMovers`), `:1271`(`vix`), `:1274`(`fearGreed`)에서 확인한 이름이다.
- `page.tsx`가 `db.dailyReport.findFirst({ orderBy: { date: "desc" } })`로 매 요청마다 조회하는데,
  홈은 `export const dynamic = "force-dynamic"`(10번째 줄)이 이미 걸려 있어 캐시 문제 없음.
