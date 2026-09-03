# 자가학습 4요소 실제 적용 강화 — 설계 문서

## 배경

`/correction-process/self-learning` 페이지의 "부족한 점" ③번(적용)에 대한 사용자 지적:
지금까지는 학습 노트가 프롬프트에 주입되는 **코드 경로만 확인**했을 뿐, 사용자가 원하는 4요소가
실제로 리포트 작성에 반영되는지는 검증되지 않았다.

사용자가 정의한 4요소(원문):
1. 지표 수집 방법 및 도출
2. 결론 도출까지의 사고 과정
3. 보고 형식
4. **보고서 자체의 내용(배경지식)** — 지금 시스템엔 없는 요소. 오히려 지금은 "오늘의 사실로
   인용하지 말고 서술 방식만 참고하라"고 명시적으로 막아뒀다(기관 의견이 이 사이트 자체의
   사실인 것처럼 섞이는 걸 막기 위해서였음).

사용자 확인 사항(대화로 합의):
- ④(배경지식)는 **암묵적 맥락으로만** 반영(특정 기관을 직접 인용하지 않음) — 단 "극한으로"
  깊게 반영되어야 함
- 적용 범위는 `generateNarrative()` 전체(일일 narrative·종합보고서·주기별 리포트·debug 라우트
  4곳 전부 동일 적용, 차등 없음)
- 압축 주기는 주 1회, **일요일 23:00 KST** 실행(ISO 주차가 월~일이라 그 주 마지막 시점, 매일
  09:00 KST 파이프라인과 안 겹침, 다음날 리포트 전까지 10시간 여유)

## 사전 조사로 확인한 사실

- **컨텍스트 길이는 제약이 아니다** — `mistral-small-latest`의 실제 한도는 262,144토큰(API로
  직접 확인). 종합보고서 기본 프롬프트가 이미 ~76,000토큰이고, 이번 주 LearningNote 65건
  원문을 전부 더해도(~124,000토큰) 한도의 절반이 안 된다.
- 그럼에도 **원문 65건을 매번 통째로 넣지 않는 이유**는 한도가 아니라 (a) 매일 4회 호출마다
  ~48,000토큰을 반복 전송하는 비용·지연 낭비, (b) 이미 큰 프롬프트에 텍스트를 더 얹을수록
  mistral-small이 `{{FINAL_SCORE}}` 같은 플레이스홀더 지시를 놓치는 문제(실측 전례 있음,
  `sanitizeFormat()`으로 겨우 보완한 것)가 악화될 위험 때문이다.
- 주간 압축본(500~1,000자 가정)을 넣으면 추가 토큰은 800~1,600 — 지금(최근 5건, ~3,900토큰)
  보다도 작다. 종합보고서 작성에 지장을 줄 가능성은 없다.

## 범위

**이번 설계가 다루는 것**: 자가학습 파이프라인의 distill 단계(4요소 확장) + 주간 압축 + 리포트
주입 방식 변경.

**다루지 않는 것**(사용자의 더 큰 목표 중 다음 단계로 미룸):
- 자산배분 가이드(주식·코인·채권·부동산·현금 비중) — 별도 프로젝트
- 자금 흐름 예측(확률 순위) — 별도 프로젝트
- 채점 엔진(`scoring/pure.ts`, `scoring/run.ts`)의 숫자 계산 로직 — 기존 원칙대로 계속 제외

## 구성 요소

### 1. `learning-distill.ts` — ④ 배경지식 요소 추가

`buildDistillPrompt()`에 기존 세 가지(첫째/둘째/셋째)에 **넷째: "이 자료가 실제로 다룬 핵심
내용(배경지식) — 어떤 사실·수치·주장을 구체적으로 다뤘는지"**를 추가한다. 기존 형식 규칙
(볼드 금지, 번호 옮기지 마라, AI티 안 나게)은 그대로 유지 — 넷째 요소도 같은 규칙을 따른다.

### 2. `learning-synthesis.ts`(신규) — 주간 압축

```ts
export function buildSynthesisPrompt(notes: { category: string; sourceName: string; summary: string }[]): string
export async function synthesizeWeeklyLearning(): Promise<{ periodKey: string; content: string } | null>
```

- 현재 `periodKey`(= `isoWeekKey(new Date())`, 일요일 23:00 KST 실행 시점은 아직 그 주 안이므로
  별도 "지난 주" 계산 불필요)에 속한 `LearningNote` 전체를 조회
- 노트가 0건이면(신규 배포 첫 주 등) `null` 반환 — 압축 생략, 에러 아님
- LLM 1회 호출로 "이번 주 학습 요약" 생성 — 프롬프트는 4요소를 개별 기관 언급 없이 **경향으로
  종합**하라고 지시(예: "여러 기관이 공통으로 조건부 서술을 선호했다", 특정 기관명을 결론
  문장의 주어로 쓰지 않음)
- `toPlainSentenceLines()`(기존 함수 재사용)로 정리 후 저장

### 3. 새 테이블 `WeeklyLearningSynthesis`

```prisma
model WeeklyLearningSynthesis {
  id        String   @id @default(cuid())
  periodKey String   @unique
  content   String
  createdAt DateTime @default(now())
}
```

`LearningNote`에 특수 sentinel 행을 끼워 넣는 대신 별도 테이블로 분리한다 — 자가학습 페이지의
기관별 필터(`InstitutionNotes.tsx`)가 이 압축본을 "기관 하나"로 잘못 집계하는 부작용을 원천
차단.

### 4. `narrative-learning-context.ts` — 조회 대상 교체

```ts
// 변경 전: db.learningNote.findMany({ orderBy, take: 5 })
// 변경 후:
export async function fetchRecentLearningContext(): Promise<string | undefined> {
  const synthesis = await db.weeklyLearningSynthesis.findFirst({ orderBy: { createdAt: "desc" } });
  return synthesis?.content;
}
```

실패 시 `undefined` 반환(기존 try/catch 패턴 그대로) — 압축본이 없어도 리포트 생성은 항상
진행된다.

### 5. `narrative.ts` — 주입 문구 완화

기존: `"참고(다른 기관들의 최근 해석 방법론 — 오늘의 사실로 인용하지 말고, 서술 방식의 참고
자료로만 써라)"`

변경: `"참고(이번 주 여러 기관의 학습 요약 — 지표·사고과정·보고형식·배경지식을 종합한 것이다.
오늘 분석의 배경 맥락으로 삼아 반영하되, 특정 기관이 이렇게 말했다는 식으로 직접 인용하거나
이 사이트 자체의 사실인 것처럼 단정하지 마라)"`

### 6. 새 크론 라우트 `api/cron/learning-synthesis`

기존 `requireCronAuth` + `sendHealthCheckAlert` 패턴 재사용. cron-job.org 등록(일요일 23:00
KST = 14:00 UTC)은 구현 단계에서 `CRON_JOB_ORG_API_KEY`로 프로그램 등록(`news-refresh` 잡 등록
전례와 동일한 방식).

### 7. 자가학습 페이지 — "이번 주 학습 요약" 섹션 추가

`WeeklyLearningSynthesis` 최신 1건을 그대로 노출 — ④가 실제로 반영되고 있다는 걸 사용자가
육안으로 검증할 수 있게 한다(기존 "출처 링크 첨부"와 같은 투명성 원칙).

## 테스트

- `learning-synthesis.test.ts`: `buildSynthesisPrompt()` 순수 함수 테스트(narrative.test.ts·
  learning-distill 기존 테스트와 같은 db mock 패턴)
- 기존 `learning-distill.test.ts`에 ④ 요소가 프롬프트에 포함되는지 케이스 추가
- `narrative-learning-context.ts`를 쓰는 기존 테스트(있다면) 갱신

## 리스크 및 완화

| 리스크 | 완화 |
|---|---|
| 압축 LLM 호출 실패(일요일 밤 Mistral 장애 등) | try/catch로 `null` 반환, 다음 리포트는 지난주 압축본을 계속 씀(덮어쓰기 전까지 유지) — 완전 실패 없음 |
| 배경지식이 이 사이트 사실처럼 오인될 위험 | 주입 문구에 "직접 인용 금지·사실처럼 단정 금지" 명시(기존 comprehensive-report.ts의 플레이스홀더 안전장치와 같은 철학) |
| 자가학습 페이지 기관 필터가 압축본을 오집계 | 별도 테이블로 분리해 원천 차단(위 3번) |
