# 자금흐름 예측 + 기댓값(손익비) 지표 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아티팩트 "남은 과제" 3번의 두 번째 하위 프로젝트(자금흐름 예측)를, 9차례 방법론 재검토 끝에 확정된 설계(과거 확률 역산 없이 오늘 신호로 판정 → `verdict-outcomes.ts`와 같은 방식으로 사후 채점 → 승률뿐 아니라 기댓값도 추적)로 구현한다.

**Architecture:** 새 DB 모델·마이그레이션 없이 기존 `DailyReport.details`(JSON, 이미 `comprehensiveReport`·`assetAllocation` 등을 담는 자리) 패턴을 그대로 재사용한다. 판정은 파이프라인이 매일 순수 함수로 계산해 저장하고(LLM 호출 없음), 채점은 `verdict-outcomes.ts`처럼 화면 요청 시점에 온더플라이로 계산한다(과거를 캐서 확률을 만드는 백테스트가 아니라, 매일 새로 판정하고 나중에 정직하게 채점하는 방식).

**Tech Stack:** 기존 스택 그대로(Next.js/Prisma/Vitest). 새 외부 API 연동 없음 — 이미 수집 중인 SPX/BTC/GOLD MetricValue와 `fetchYahooHistorical`을 재사용.

## Global Constraints

- 과거 국면 통계를 역산하지 않는다 — 오늘 신호로만 판정한다(9차 방법론 재검토 결론, Howard Marks/Soros/Taleb 교차검증 완료).
- 판정 대상은 실제 수익률 시계열이 있는 자산만: 주식(SPX)·코인(BTC)·금(GOLD). 채권·부동산은 이 사이트에 실제 데이터가 없어 제외하고 "데이터 없음"으로 명시한다(자산배분 가이드와 동일 원칙).
- 채점은 `verdict-outcomes.ts`의 기존 원칙을 그대로 따른다: 리포트 당일이 아니라 다음 거래일부터 기산(룩어헤드 방지), ±0.5% 무의미구간 제외, 아직 안 지난 건 null(모른다≠틀렸다).
- 승률(hit rate)뿐 아니라 기댓값(맞았을 때 평균 수익 vs 틀렸을 때 평균 손실)을 반드시 함께 계산·표시한다(Druckenmiller/Soros 교차검증 결론 — "승률보다 손익비").
- LLM을 이 계산에 관여시키지 않는다 — 전부 결정론적 순수 함수.
- 처음엔 표본 0건이다 — "검증 중"이라고 화면에 명시하고, 채점 가능한 표본이 쌓이기 전까지 승률·기댓값 카드는 "채점 가능한 표본 없음"으로 표시한다(기존 `StatCard`의 null 분기와 동일 패턴).

---

### Task 1: `scoring/types.ts` — 자금흐름 예측 타입 추가

**Files:**
- Modify: `src/lib/scoring/types.ts`

**Interfaces:**
- Produces: `CapitalFlowForecastAsset`, `CapitalFlowForecast` 타입 — Task 2·3·4가 이 타입을 그대로 쓴다.

- [ ] **Step 1: 타입 추가**

`AssetAllocation` 인터페이스 바로 아래에 추가:

```ts
// 자금흐름 예측 — 오늘 신호로 방향만 판정한다(과거 확률 역산 없음, 9차 방법론 재검토 결론).
// 채권·부동산은 실제 수익률 시계열이 없어 제외.
export type CapitalFlowForecastAssetKey = "stock" | "coin" | "gold";
export interface CapitalFlowForecastAsset {
  asset: CapitalFlowForecastAssetKey;
  direction: "up" | "down"; // 다음 5거래일 방향 판정
  rank: number; // 1이 가장 강한 신호
  reason: string; // 어떤 신호로 이 순위를 매겼는지(결정론적 문구, LLM 아님)
}
export interface CapitalFlowForecast {
  computedAt: string; // ISO date — 이 판정을 계산한 marketDate
  assets: CapitalFlowForecastAsset[];
}
```

`StepDetails` 타입에 필드 추가(기존 `comprehensiveReportNoContext` 옆):

```ts
  capitalFlowForecast?: CapitalFlowForecast; // 오늘 신호 기반 자금흐름 방향 판정(사후 채점용, track-record와 같은 원칙)
```

- [ ] **Step 2: tsc 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음(옵셔널 필드라 기존 코드 전부 무영향).

---

### Task 2: `src/lib/capital-flow-forecast.ts`(신규) — 오늘 신호 기반 순위 계산

**Files:**
- Create: `src/lib/capital-flow-forecast.ts`
- Test: `src/lib/capital-flow-forecast.test.ts`

**Interfaces:**
- Consumes: `Step4Result`(quadrant), `Step5Result`(coinMomentumHigherThanStock) — Task 1 이전에 이미 존재하는 타입.
- Produces: `computeCapitalFlowForecast(step4: Step4Result, step5: Step5Result, marketDate: string): CapitalFlowForecast` — Task 3이 그대로 부른다.

**판정 규칙(전부 결정론적, 상수로 노출)**:

- 금(gold): step4 quadrant가 "금↑"로 시작하면 up, 아니면 down.
- 코인(coin): step5.coinMomentumHigherThanStock이 true면 up, false/null이면 down.
- 주식(stock): step4 quadrant에 "실질금리↑"가 포함되면 down(안전자산에서 금융자산으로 이동 중이라는 기존 quadrant 해설과 반대 방향 — 실질금리 상승은 밸류에이션 압박이라는 통념), 아니면 up.
- 순위(rank)는 신호의 "확신도" 대신 고정 우선순위(코인→주식→금 순으로 신호가 명확할 때 순서 배정)로 매긴다 — 확신도 점수화는 새 임의 가중치를 만드는 것이라 이번 범위에서 제외(YAGNI, 필요해지면 후속 작업).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { computeCapitalFlowForecast } from "./capital-flow-forecast";
import type { Step4Result, Step5Result } from "./scoring/types";

const step4Base: Step4Result = { quadrant: "금↓/보합 실질금리↑", score: 5, note: "", dollarConfirms: false };
const step5Base: Step5Result = {
  gapPp: 0, concentrationWarning: false, riskAppetite: "중립", score: 5,
  cryptoAlignsWithRisk: null, coinMomentumHigherThanStock: null,
};

describe("computeCapitalFlowForecast", () => {
  it("금↓ 실질금리↑ + 코인 모멘텀 약세면 주식 down·코인 down·금 down", () => {
    const result = computeCapitalFlowForecast(step4Base, step5Base, "2026-09-05");
    const byAsset = Object.fromEntries(result.assets.map((a) => [a.asset, a.direction]));
    expect(byAsset.stock).toBe("down");
    expect(byAsset.coin).toBe("down");
    expect(byAsset.gold).toBe("down");
  });

  it("금↑ 실질금리↓/보합 + 코인 모멘텀 강세면 금 up·코인 up·주식 up", () => {
    const step4: Step4Result = { ...step4Base, quadrant: "금↑ 실질금리↓/보합" };
    const step5: Step5Result = { ...step5Base, coinMomentumHigherThanStock: true };
    const result = computeCapitalFlowForecast(step4, step5, "2026-09-05");
    const byAsset = Object.fromEntries(result.assets.map((a) => [a.asset, a.direction]));
    expect(byAsset.gold).toBe("up");
    expect(byAsset.coin).toBe("up");
    expect(byAsset.stock).toBe("up");
  });

  it("자산 3개(주식·코인·금) 전부 순위(1~3)가 매겨진다", () => {
    const result = computeCapitalFlowForecast(step4Base, step5Base, "2026-09-05");
    const ranks = result.assets.map((a) => a.rank).sort();
    expect(ranks).toEqual([1, 2, 3]);
  });

  it("computedAt에 넘긴 marketDate가 그대로 들어간다", () => {
    const result = computeCapitalFlowForecast(step4Base, step5Base, "2026-08-01");
    expect(result.computedAt).toBe("2026-08-01");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/capital-flow-forecast.test.ts`
Expected: FAIL(모듈 없음)

- [ ] **Step 3: 구현**

```ts
// 자금흐름 예측 — 오늘 신호로 방향만 판정한다. 과거 국면 통계를 역산하지 않는다(9차 방법론
// 재검토 결론: whipsaw·자기상관 유사표본·룩어헤드 편향·다중비교·기저율 무시 문제를 전부
// 피하려면, 과거를 캐서 확률을 만드는 대신 매일 새로 판정하고 나중에(verdict-outcomes.ts와
// 같은 방식으로) 정직하게 채점하는 쪽이 이 사이트의 원칙과 거장들의 조언(Marks "예측 대신
// 준비"·Soros "정량화 못 하는 불확실성"·Taleb "다중비교는 필연적으로 가짜 유의성을 만듦")에
// 맞다). 채권·부동산은 실제 수익률 시계열이 없어 판정 대상에서 제외(자산배분 가이드와 동일 원칙).
import type { Step4Result, Step5Result } from "./scoring/types";
import type { CapitalFlowForecast, CapitalFlowForecastAsset, CapitalFlowForecastAssetKey } from "./scoring/types";

export function computeCapitalFlowForecast(
  step4: Step4Result,
  step5: Step5Result,
  marketDate: string
): CapitalFlowForecast {
  const goldUp = step4.quadrant.startsWith("금↑");
  const rateUp = step4.quadrant.includes("실질금리↑");
  const coinUp = step5.coinMomentumHigherThanStock === true;

  const directions: Record<CapitalFlowForecastAssetKey, { direction: "up" | "down"; reason: string }> = {
    gold: {
      direction: goldUp ? "up" : "down",
      reason: goldUp ? "4단계 사분면이 금↑로 판정됨" : "4단계 사분면이 금↓/보합으로 판정됨",
    },
    coin: {
      direction: coinUp ? "up" : "down",
      reason: coinUp
        ? "5단계: (BTC+ETH)/2 20일 수익률이 (NDX+RUT)/2보다 높음"
        : "5단계: 코인 모멘텀이 주식보다 약하거나 코인 데이터 없음",
    },
    stock: {
      direction: rateUp ? "down" : "up",
      reason: rateUp
        ? "4단계 사분면이 실질금리↑ — 밸류에이션 압박 신호"
        : "4단계 사분면이 실질금리↓/보합 — 밸류에이션 압박 신호 없음",
    },
  };

  // 순위는 확신도 점수화 없이 고정 우선순위(코인→주식→금)로 배정한다 — 새 임의 가중치를
  // 만들지 않기 위한 의도적 단순화(YAGNI, Global Constraints 참고).
  const order: CapitalFlowForecastAssetKey[] = ["coin", "stock", "gold"];
  const assets: CapitalFlowForecastAsset[] = order.map((asset, i) => ({
    asset,
    direction: directions[asset].direction,
    rank: i + 1,
    reason: directions[asset].reason,
  }));

  return { computedAt: marketDate, assets };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/capital-flow-forecast.test.ts`
Expected: PASS(4/4)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/capital-flow-forecast.ts src/lib/capital-flow-forecast.test.ts src/lib/scoring/types.ts
git commit -m "feat: 자금흐름 예측 오늘신호 판정 로직 추가"
```

---

### Task 3: `pipeline.ts` — 매일 판정 저장

**Files:**
- Modify: `src/lib/pipeline.ts`

**Interfaces:**
- Consumes: `computeCapitalFlowForecast()`(Task 2)

- [ ] **Step 1: 종합보고서 생성부 근처에 판정 저장 추가**

```ts
// 기존(9/5 커밋에서 추가된 A/B 비교 블록 바로 아래)
try {
  report.details.comprehensiveReportNoContext = await generateComprehensiveReport(report, { skipLearningContext: true });
} catch (err) {
  sourceErrors.push({ source: "학습요약 A/B 비교(대조군)", error: err instanceof Error ? err.message : String(err) });
}

// 추가 — LLM 호출 없는 순수 계산이라 실패 가능성이 사실상 없지만, 방어적으로 감싼다.
try {
  report.details.capitalFlowForecast = computeCapitalFlowForecast(report.step4, report.step5, marketDate);
} catch (err) {
  sourceErrors.push({ source: "자금흐름 예측 판정", error: err instanceof Error ? err.message : String(err) });
}
```

import 추가: `import { computeCapitalFlowForecast } from "@/lib/capital-flow-forecast";`

- [ ] **Step 2: tsc + 전체 테스트**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 에러 없음, 전체 PASS.

- [ ] **Step 3: 커밋**

```bash
git add src/lib/pipeline.ts
git commit -m "feat: 파이프라인이 매일 자금흐름 예측 판정을 저장하도록 연결"
```

---

### Task 4: `verdict-outcomes.ts` — 기댓값(손익비) 통계 + 자금흐름 예측 채점

**Files:**
- Modify: `src/lib/verdict-outcomes.ts`
- Test: `src/lib/verdict-outcomes.test.ts`(기존 파일에 케이스 추가)

**Interfaces:**
- Produces: `expectancyStats(outcomes, key): {avgWinPct, avgLossPct, winCount, lossCount} | null` — Task 5(UI)가 부른다.
- Produces: `gradeCapitalFlowForecast(forecast, priceAt5d): {asset, direction, hit, returnPct}[]` — Task 5가 부른다.

- [ ] **Step 1: 기댓값 통계 함수 — 실패하는 테스트 먼저**

기존 `verdict-outcomes.test.ts`에 추가:

```ts
describe("expectancyStats", () => {
  it("승리군·패배군 평균 수익률을 각각 낸다", () => {
    const outcomes = [
      { hitSp500: true, sp500ReturnPct: 8 },
      { hitSp500: true, sp500ReturnPct: 4 },
      { hitSp500: false, sp500ReturnPct: -3 },
      { hitSp500: null, sp500ReturnPct: null },
    ] as VerdictOutcome[];
    const result = expectancyStats(outcomes, "hitSp500", "sp500ReturnPct");
    expect(result?.winCount).toBe(2);
    expect(result?.avgWinPct).toBe(6); // (8+4)/2
    expect(result?.lossCount).toBe(1);
    expect(result?.avgLossPct).toBe(-3);
  });

  it("채점 가능한 표본이 없으면 null", () => {
    expect(expectancyStats([], "hitSp500", "sp500ReturnPct")).toBeNull();
  });
});
```

- [ ] **Step 2: 구현**

```ts
/**
 * 승률(hitStats)만으론 "손익비"를 못 본다 — Druckenmiller/Soros 교차검증 결론(승률 30%여도
 * 손익비가 좋으면 유효한 신호일 수 있다)에 따라 승리군·패배군 평균 수익률을 따로 낸다.
 * 표본이 극히 적을 때 평균이 이상치 하나에 휘둘릴 수 있음을 화면에서 winCount/lossCount로
 * 같이 밝혀야 한다(hitStats가 분모를 같이 보여주는 것과 같은 원칙).
 */
export function expectancyStats(
  outcomes: VerdictOutcome[],
  hitKey: "hitSp500" | "hitKospi",
  returnKey: "sp500ReturnPct" | "kospiReturnPct"
): { winCount: number; avgWinPct: number; lossCount: number; avgLossPct: number } | null {
  const graded = outcomes.filter((o) => o[hitKey] !== null && o[returnKey] !== null);
  if (graded.length === 0) return null;
  const wins = graded.filter((o) => o[hitKey] === true).map((o) => o[returnKey] as number);
  const losses = graded.filter((o) => o[hitKey] === false).map((o) => o[returnKey] as number);
  const avg = (xs: number[]) => (xs.length === 0 ? 0 : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100);
  return { winCount: wins.length, avgWinPct: avg(wins), lossCount: losses.length, avgLossPct: avg(losses) };
}
```

- [ ] **Step 3: 자금흐름 예측 채점 함수 — 실패하는 테스트**

```ts
describe("gradeCapitalFlowForecast", () => {
  it("direction=up이고 실현 수익률이 양수(+0.5% 초과)면 적중", () => {
    const forecast: CapitalFlowForecast = {
      computedAt: "2026-08-01",
      assets: [{ asset: "stock", direction: "up", rank: 1, reason: "" }],
    };
    const result = gradeCapitalFlowForecast(forecast, { stock: 2.1, coin: null, gold: null });
    expect(result[0].hit).toBe(true);
    expect(result[0].returnPct).toBe(2.1);
  });

  it("무의미구간(±0.5%) 안쪽이면 방향 무관 미적중", () => {
    const forecast: CapitalFlowForecast = {
      computedAt: "2026-08-01",
      assets: [{ asset: "stock", direction: "up", rank: 1, reason: "" }],
    };
    const result = gradeCapitalFlowForecast(forecast, { stock: 0.2, coin: null, gold: null });
    expect(result[0].hit).toBe(false);
  });

  it("아직 가격 데이터 없으면(null) hit도 null", () => {
    const forecast: CapitalFlowForecast = {
      computedAt: "2026-08-01",
      assets: [{ asset: "gold", direction: "down", rank: 1, reason: "" }],
    };
    const result = gradeCapitalFlowForecast(forecast, { stock: null, coin: null, gold: null });
    expect(result[0].hit).toBeNull();
  });
});
```

- [ ] **Step 4: 구현**

```ts
import type { CapitalFlowForecast, CapitalFlowForecastAssetKey } from "./scoring/types";

export interface CapitalFlowGrade {
  asset: CapitalFlowForecastAssetKey;
  direction: "up" | "down";
  returnPct: number | null;
  hit: boolean | null;
}

/** verdict-outcomes.ts의 gradeHit()과 같은 무의미구간(NEUTRAL_BAND_PCT) 원칙을 그대로 쓴다. */
export function gradeCapitalFlowForecast(
  forecast: CapitalFlowForecast,
  returnPctAt5d: Record<CapitalFlowForecastAssetKey, number | null>
): CapitalFlowGrade[] {
  return forecast.assets.map((a) => {
    const returnPct = returnPctAt5d[a.asset];
    let hit: boolean | null = null;
    if (returnPct !== null) {
      hit = a.direction === "up" ? returnPct > NEUTRAL_BAND_PCT : returnPct < -NEUTRAL_BAND_PCT;
    }
    return { asset: a.asset, direction: a.direction, returnPct, hit };
  });
}
```

- [ ] **Step 5: 테스트 통과 + tsc + 전체 스위트**

Run: `npx vitest run src/lib/verdict-outcomes.test.ts && npx tsc --noEmit && npx vitest run`
Expected: 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/verdict-outcomes.ts src/lib/verdict-outcomes.test.ts
git commit -m "feat: 기댓값(손익비) 통계 + 자금흐름 예측 채점 함수 추가"
```

---

### Task 5: UI — 오늘의 리포트에 판정 노출 + track-record에 기댓값·자금흐름 예측 채점 노출

**Files:**
- Modify: `src/lib/scoring/run.ts`(details.step8 표에 요약 행 추가 — 자산배분 가이드와 같은 패턴)
- Modify: `src/app/track-record/page.tsx`
- Modify: `src/components/TrackRecordGraphs.tsx`(또는 `StatCard`에 기댓값 줄 추가)

**Interfaces:**
- Consumes: Task 2·4의 모든 함수

- [ ] **Step 1: `run.ts`의 `details.step8`에 자금흐름 예측 요약 행 추가**

(자산배분 가이드 행 바로 아래, 같은 패턴 — `computeCapitalFlowForecast` 호출은 pipeline.ts가 하므로 여기서는 이미 계산된 `report.details.capitalFlowForecast`를 읽어 문자열로만 조립한다. run.ts 실행 시점엔 아직 details.capitalFlowForecast가 없으므로, 이 행은 pipeline.ts가 details를 다 채운 "뒤"에 별도로 추가하거나, Task 3에서 pipeline.ts가 이 행까지 같이 push하도록 조정 — 구현 시 정확한 삽입 지점은 pipeline.ts의 실행 순서를 다시 확인해서 정할 것.)

- [ ] **Step 2: `StatCard`에 기댓값 표시 추가**

`stats` prop 옆에 `expectancy` prop 추가, `expectancyStats()` 결과가 있으면 "적중 시 평균 +{avgWinPct}% · 미적중 시 평균 {avgLossPct}%(승 {winCount}건·패 {lossCount}건)" 한 줄 표시. 표본 없으면(null) 표시 안 함(기존 null 분기 패턴 재사용).

- [ ] **Step 3: `/track-record`에 자금흐름 예측 채점 섹션 추가**

기존 S&P500·코스피 카드 옆(또는 아래)에 자산 3개(주식/코인/금) 각각의 적중률+기댓값 카드 추가. 데이터 소스: 최근 N건 `DailyReport.details.capitalFlowForecast` + `gradeCapitalFlowForecast()` + 5거래일 뒤 SPX/BTC/GOLD 실현 수익률(기존 `fetchYahooHistorical`·CoinGecko 과거 조회 재사용, 새 API 연동 없음).

- [ ] **Step 4: 로컬 브라우저 실동작 확인**

`npm run dev` → `/track-record`, `/report` 방문 → 표본 0건 상태에서 "채점 가능한 표본 없음"이 정상 표시되는지, 콘솔 에러 없는지 확인.

- [ ] **Step 5: 전체 테스트 + tsc + 커밋**

```bash
npx tsc --noEmit && npx vitest run
git add -A
git commit -m "feat: 자금흐름 예측 UI 노출(오늘의 리포트 + track-record 기댓값)"
```

---

## 실사용 안내(계획 범위 밖, 구현 완료 후 자연히 해결됨)

Task 1~5가 끝나도 **당장은 표본 0건**이라 화면엔 "검증 중"만 보입니다. 매일 파이프라인이 판정을 쌓고 5거래일 뒤부터 하나씩 채점되기 시작하며, 의미 있는 승률·기댓값이 쌓이기까지 몇 주 이상 걸립니다 — 이건 버그가 아니라 설계 자체(과거 역산 없이 매일 새로 판정)의 자연스러운 결과입니다.

## 범위 밖(이번 계획에 포함하지 않음, 별도 판단 필요)

- 오늘 배포된 자산배분 가이드의 "코인(달력일) vs 주식(거래일) 20일 기간 불일치"(6차 재검토 발견) — 이번 계획과 별개로 고칠지 결정 필요.
- 기존 `verdict-outcomes.ts`(매수/지켜보기/현금비중늘리기 판정)에도 손익비 통계를 소급 적용할지 — Task 4에서 함수는 범용으로 만들지만, 화면(`/track-record`의 기존 S&P500/코스피 카드)에 실제로 붙이는 건 Task 5 Step 2에서 같이 하되, 사용자가 원치 않으면 자금흐름 예측 카드에만 한정 가능.
