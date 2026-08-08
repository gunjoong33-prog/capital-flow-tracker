# 홈 화면 PPT 슬라이드 카드

## 배경

인스타그램 계정 macro_floww(macro_floww)의 카드뉴스 형식(검은 배경, 라임그린 포인트색, 킥커 라벨 +
훅 헤드라인 + 데이터 시각화 + 하단 출처/페이지번호, 슬라이드 넘기기)을 이 사이트의 8단계 체크리스트
결과에 적용해 달라는 요청에서 시작했다. Chrome으로 실제 게시물(`DbmHtGpjw2h`)을 슬라이드별로 직접
넘겨보며 톤·레이아웃을 확인했다.

브레인스토밍 과정에서 두 가지가 좁혀졌다:
- **배치**: 처음엔 "오늘의 리포트"·"주기별 리포트" 페이지의 "종합 보고서 보기" 옆에 넣으려 했으나,
  사용자가 **홈 화면**(`/`)의 히어로 섹션 오른쪽 빈 여백(환율·CNN 공포탐욕 카드 위)으로 방향을
  바꿨다. 오늘의 리포트/주기별 리포트 적용은 **이번 범위에서 보류**.
- **콘텐츠 생성 방식**: (A) 완전 결정론적 vs (B) 매 슬라이드 LLM 생성 두 안을 실제 8/8 데이터로
  초안을 써서 비교한 뒤, **(C) 절충안**으로 확정 — 숫자·사실 문장은 전부 코드로 고정하고, 슬라이드당
  훅 헤드라인 한 줄만 LLM이 짓는다. 이번 세션에서 고친 "LLM이 숫자를 잘못 옮겨 적는" 부류의 버그가
  헤드라인 생성 경로에서 원천적으로 발생할 수 없다(LLM에게 숫자를 아예 안 준다).
- **레이아웃 세부**: HTML 목업을 Chrome에 띄워 반복 조정 — 처음엔 전체 폭 카드로 시작했다가
  (1) 좌측 환율 카드를 가리면 안 된다, (2) CNN 공포탐욕 카드와 같은 폭이어야 한다, (3) 위젯 grid
  위가 아니라 히어로 텍스트 오른쪽 여백에 들어가야 한다, (4) 헤더 로고·5개 네비게이션·라이트/다크
  토글은 손대지 않는다 — 순서로 확정했다.

## 목표

- 홈 화면 히어로 섹션 오른쪽 여백에 오늘의 체크리스트를 9장짜리 카드뉴스 형식으로 보여준다
  (1~8단계 각 1장 + 종합 결론 1장).
- 매일 아침 9시 파이프라인이 기존 `comprehensiveReport`와 함께 이 9장도 같이 생성해 저장한다.
- 숫자·사실은 100% 결정론적(코드), 슬라이드당 훅 헤드라인 한 줄만 LLM이 생성한다.
- 라이트/다크 테마 자동 대응(사이트 기존 CSS 변수 재사용).
- 헤더·네비게이션·테마 토글·히어로 텍스트/버튼·환율 카드·CNN 공포탐욕 카드는 전혀 변경하지 않는다.
- 오늘의 리포트·주기별 리포트 페이지 적용은 이번 범위에서 제외한다.

## 데이터 모델

`DailyReport.details`(기존 JSON 컬럼)에 새 필드 `pptSlides` 추가:

```ts
// src/lib/scoring/types.ts, StepDetails에 추가
pptSlides?: PptSlide[];

export interface PptSlide {
  step: number; // 1~8, 9(종합 결론)
  kicker: string; // 예: "사실 · 캐리 트레이드" — 결정론적
  headline: string; // 훅 헤드라인 1~2줄 — LLM 생성, 실패 시 폴백
  body: string; // 보조 설명 1~2문장 — 결정론적(stepNSummary 재사용/축약)
  visual:
    | { type: "stat-pair"; left: { value: string; label: string; tone?: "pos" | "neg" | "accent" }; right: { value: string; label: string; tone?: "pos" | "neg" | "accent" } }
    | { type: "bar-pair"; left: { value: string; label: string; heightPct: number }; right: { value: string; label: string; heightPct: number } }
    | { type: "ratio-bar"; qualifying: number; total: number; label: string }
    | { type: "weight-bars"; rows: { label: string; score: number; weight: number }[] }
    | { type: "none" };
}
```

`headline`은 플레이스홀더 없이 **최종 텍스트**만 저장한다(`comprehensiveReport`의 `{{FINAL_SCORE}}`
패턴과 달리, 헤드라인은 숫자를 포함하지 않게 프롬프트에서 강제하므로 사후 치환이 필요 없다).

## 신규 로직 1: 슬라이드 조립 — `src/lib/scoring/run.ts` 내부

`forwardSignals`와 같은 원칙: LLM 없이, `runDailyAnalysis()` 안에서 이미 계산된 로컬 변수(step1~8
결과, `vix`, `fearGreed`, `netLiq`, `creditSpreadBp`, `step3.spreadBp` 등)에 바로 접근할 수 있는
위치에서 순수 함수로 조립한다. 새 헬퍼 `buildPptSlides(...)`를 `run.ts` 상단(다른 헬퍼들 옆)에 추가:

| # | step | kicker | visual | 근거 |
|---|---|---|---|---|
| 1 | 1 | 사실 · 오늘의 결론 | stat-pair(투자 적합도 점수, 거부권 여부) | `step8.macroTrendScore`, `step1.vetoTriggered` |
| 2 | 2 | 사실 · 유동성 | ratio-bar(우호 지표 개수/6) | `step2.overseasQualifyingCount/overseasTotalCount` |
| 3 | 3 | 사실 · 캐리 트레이드 | bar-pair(현재 스프레드 vs 안전마진 350bp) | `step3.spreadBp` |
| 4 | 4 | 사실 · 환율·금·유가 | stat-pair(사분면, 점수) | `step4.quadrant`, `step4.score` |
| 5 | 5 | 사실 · 자금 도착 | stat-pair(빅테크 최대 상승/하락 종목) | `step5BigTech`에서 최대/최소 |
| 6 | 6 | 사실 · 섹터 | stat-pair(5일 수익률 1위 섹터, 충족 섹터 수) | `step6.qualifying`, 6단계 aux |
| 7 | 7 | 사실 · 심리 필터 | stat-pair(VIX, 공포탐욕지수) | `vix`, `fearGreed` 로컬 변수 |
| 8 | 8 | 사실 · 최종 결론 계산 | weight-bars(단계별 점수×가중치) | 기존 `step8Details` 배열 재사용 |
| 9 | — | 결론 | stat-pair(점수, 최종 결론 배지) | `step8.macroTrendScore`, `step8.finalDecision` |

`body`는 각 단계의 기존 `stepNSummary` 첫 문장(또는 첫 40자 내외로 자름)을 그대로 재사용한다 —
새 문장을 만들지 않는다.

## 신규 로직 2: 헤드라인 생성 — `src/lib/ppt-headlines.ts`

`bigtech-reasons.ts`와 같은 패턴(가볍고 빈도 낮은 판단 → Groq, `reasoningEffort: "low"`):

```ts
export async function generatePptHeadlines(slides: PptSlide[]): Promise<Record<number, string>>
```

- 프롬프트에는 각 슬라이드의 `kicker`+`body`(둘 다 이미 결정론적으로 확정된 사실 문장)만 넘긴다 —
  **숫자를 포함한 원본 수치는 프롬프트에 아예 포함하지 않는다**(전달하지 않으면 잘못 옮길 수도 없다).
- 응답은 슬라이드 번호별 훅 헤드라인 1~2줄(존댓말 금지 — macro_floww 톤은 평서형 명사구, 예:
  "스프레드는 위험한데 엔화는 왜 조용한가"). "숫자를 쓰지 마라"는 규칙을 프롬프트에 명시하고,
  생성된 헤드라인에 아라비아 숫자가 섞여 있으면(정규식 `/\d/` 검출) 그 슬라이드만 폴백 처리한다.
- 실패(호출 에러·숫자 검출)한 슬라이드는 `kicker`를 그대로 `headline`으로 사용(예: "사실 ·
  캐리 트레이드"를 축약 없이 그대로) — 화면에 카드 자체가 안 뜨는 것보단 안전.
- 9개를 한 번에 배치 호출(개별 호출 9번이 아니라 1번) — `judgeBigTechReasons()`가 7종목을 한
  프롬프트로 묶는 것과 같은 비용 절감 이유.

## `pipeline.ts` 연동

`generateComprehensiveReport()` 호출 옆에 추가:

```ts
const pptSlidesBase = report.details.pptSlides; // run.ts가 이미 채워둔 결정론적 필드(headline 제외)
const headlines = await generatePptHeadlines(pptSlidesBase);
report.details.pptSlides = pptSlidesBase.map((s) => ({ ...s, headline: headlines[s.step] ?? s.kicker }));
```

`comprehensiveReport`와 같은 실패 허용 원칙 — 헤드라인 생성 전체가 실패해도 파이프라인은 계속
진행하고, `pptSlides`는 킥커를 헤드라인으로 쓴 상태로 저장된다(`try/catch`로 감싸고 `console.error`
남김, `refresh-report.ts`의 `--regen-report` 플래그처럼 재생성 스크립트도 나중에 추가 가능하나
이번 범위 밖).

## UI 컴포넌트: `src/components/PptSlideDeck.tsx`

Chrome에서 검증한 목업(`ppt-mockup-home.html`)을 그대로 컴포넌트화:
- 클라이언트 컴포넌트(`"use client"`) — 슬라이드 인덱스 state, `‹›` 버튼 + 점 페이지네이션.
- 색상은 전부 `var(--bg-raised)`, `var(--border)`, `var(--ink)`, `var(--ink-dim)`, `var(--ink-faint)`,
  `var(--accent)`, `var(--accent-strong)`, `var(--pos)`, `var(--neg)` — 사이트 라이트/다크 변수
  그대로 사용(별도 다크 전용 팔레트 없음 → 목업 단계의 "검은 배경+라임그린 고정" 컨셉은 채택하지
  않고, 사이트 테마를 따르는 쪽으로 확정됨).
- 점 페이지네이션의 활성 표시는 `width` 트랜지션이 아니라 `transform: scaleX()` 사용(레이아웃
  스래싱 방지 — 목업 리뷰 중 지적된 부분 실제 구현에 반영).
- props: `slides: PptSlide[]`. 데이터 없으면(옛날 리포트 등 `pptSlides` 없음) 컴포넌트 자체를
  렌더링하지 않음(`page.tsx`에서 조건부 렌더).

## `page.tsx` 레이아웃 변경

`.hero`(단일 컬럼)를 `.hero-grid`(`grid-template-columns: 1.2fr 1fr; gap: 1.25rem` — 아래
`.widgetGrid`와 동일한 비율+gap이라 두 섹션이 물리적으로 다른 grid라도 오른쪽 컬럼 폭이 자동으로
맞음)로 변경. 왼쪽 칸(`.hero-left`)에 기존 eyebrow·title·desc·ctaRow를 그대로 옮기고(내용·클래스
무변경), 오른쪽 칸(`.hero-right`)에 `<PptSlideDeck>`을 배치.

`getReportRow()`와 같은 방식으로 최신 `DailyReport`를 조회해 `details.pptSlides`를 `page.tsx`에
전달(현재 홈은 DailyReport를 안 읽으므로 새 쿼리 1개 추가, `report/page.tsx`의 fallback 로직
재사용).

## 테스트 계획

- `buildPptSlides()`: `pure.test.ts` 옆에 유닛 테스트 — 각 visual 타입이 올바른 값을 담는지,
  step6.qualifying이 빈 배열일 때 ratio-bar가 0/N을 정직하게 보여주는지 등 경계 케이스.
- `generatePptHeadlines()`: 숫자 검출 폴백 로직만 유닛 테스트(실제 LLM 호출은 목킹).
- 수동 검증: `npx tsx scripts/refresh-report.ts <date> --regen-report`로 오늘 리포트 재생성 후
  Chrome으로 홈 화면 라이트/다크 둘 다 스크린샷 확인(이번 세션 워크플로우 그대로).

## 범위 밖 (이번엔 안 함)

- 오늘의 리포트 / 주기별 리포트 페이지에 같은 카드 추가 — 사용자가 명시적으로 보류.
- 이미지(PNG) export, 실제 인스타그램 업로드 자동화.
- 과거 저장된 리포트에 대한 소급 `pptSlides` 생성(원한다면 `regen-narrative-08.ts`와 같은 패턴의
  별도 1회성 스크립트로 나중에 처리).
