# 적중률 자기학습/개선 기능 — 설계 문서

## 배경

지난 감사 프로젝트(`2026-08-24-codebase-audit-cleanup-design.md`)에서 두 프로젝트로 분리했던 것 중 두 번째, "적중률 자기학습/개선 기능"의 설계다.

사용자가 정의한 목표(원문 취지 요약):
- 사이트가 스스로 공식 외부 자료(증권사·헤지펀드·은행 등)를 분석해 **지표 해석 방법·결론에 이르는 사고 과정·리포트 작성 방식**을 학습하고, 옵시디언 vault에 종류별로 정리해 쌓는다.
- 그 지식과 과거 적중률 데이터를 근거로, 사람을 거치지 않고 스스로 검토·오류 수정을 반복해 지표 정확성과 종합판단·종합보고서 품질을 계속 끌어올린다.
- 오류를 발견하면 코드 수준까지 스스로 고쳐서 배포하되, 성공이든 실패든 사람에게 보고·알림한다.
- 종합판단·종합보고서는 "지표가 이래서 이랬다" 식 나열이 아니라, **원인 → 결과 → 향후 자금 흐름 전망**의 명확한 인과관계로 쓴다.
- 모든 서술은 비전공자가 읽어도 명쾌하도록 문장 자체가 쉬워야 한다(괄호 풀이가 아니라 문장 구조 자체가 쉬워야 함).

## 범위

**3대 구성요소**
1. 외부 데이터 학습 파이프라인 + 지식 베이스(옵시디언 동기화 포함)
2. 리포트 품질 개선(인과관계 서술, 쉬운 문장)
3. 자율 자가진단 · 자가수정 · 테스트 게이트 자동배포 파이프라인

**계속 손대지 않는 것**: `runDailyAnalysis`(`src/lib/scoring/run.ts`)·`runDailyPipeline`(`src/lib/pipeline.ts`)의 채점 로직 자체(WEIGHTS·임계값 등 숫자 계산). 옵시디언 vault의 `문제점 및 보완점/트래커.md`에 이미 "회귀 위험 커서 스코프 제외" 전례가 있고, 지난주 코드 감사 프로젝트에서도 같은 이유로 손대지 않았다. 3번 자율 파이프라인도 이 두 함수(및 이들이 직접 호출하는 `src/lib/scoring/pure.ts`의 `scoreStep1~8`, `WEIGHTS`, `decisionFromScore`)를 수정 대상에서 하드코딩으로 제외한다. 엔진 자체의 전면 개편은 사용자가 언급한 대로 완전히 별도의 미래 프로젝트다.

## 1. 외부 데이터 학습 파이프라인 + 지식 베이스

### 1.1 데이터 소스

| 소스 | 내용 | 접근 방식 | 주기 |
|---|---|---|---|
| SEC EDGAR 13F | 헤지펀드 분기별 포지셔닝 | 무료·공식 API(`sec.gov/data-research/sec-markets-data/form-13f-holdings`), 최대 45일 지연 | 분기 |
| BIS SDMX API | 중앙은행 공동기관 데이터(은행간·부채증권·환율·정책금리) | 무료·공식 REST(`stats.bis.org/api-doc/v1`), 특정 은행 편향 없음 | 주간 |
| 국내 증권사 컨센서스 | 투자의견·목표주가 분포 | 네이버금융/FnGuide 무료 페이지 스크래핑(API 키 불필요) | 주간 |
| 기존 뉴스 파이프라인 확장 | 월가 은행(JPM/GS/BofA/Citi/모건스탠리 등) 무료 공개 전망 인용 캐치 | 이들 은행은 무료 API가 없어 직접 연동 불가 — 이미 있는 뉴스 헤드라인 수집(`src/lib/sources/news-feeds.ts`, `src/lib/news-events.ts`)에서 인용 문구를 잡는 것이 유일하게 현실적인 경로 | 일간(기존 파이프라인에 통합) |
| Finnhub 무료 등급분포 | 매수~매도 등급 분포(목표주가는 유료 전용이라 제외) | 무료 티어(분당 60건) | 주간 |
| 토스증권 · 한국투자증권(KIS) API | 국내 시세·잔고 등 | 사용자가 키를 직접 구해 제공 예정 — 도착 시 별도 태스크로 통합 | — |

**제외 확인된 것**: 골드만삭스 Marquee, JP모건 DataQuery, 블랙록 Aladdin — 전부 기관 고객 전용, 무료 API 없음. Citadel·Renaissance·Two Sigma·Millennium 등 대형 퀀트 헤지펀드는 시장 견해를 공개 발행하지 않음. TradingView·Seeking Alpha도 공식 무료 API 없음.

### 1.2 저장 — Vercel 서버리스 제약

이 사이트는 Vercel 서버리스로 배포되어 사용자 로컬 PC의 옵시디언 vault 폴더에 서버가 직접 파일을 쓸 수 없다(ai-macro-company 프로젝트에서 동일한 문제로 "DB-only"로 결정한 전례 있음). 따라서:

- 원본 데이터·distill된 해석 방법론은 **DB에 저장**(아래 스키마 참조)
- 옵시디언 "학습" 폴더에 실제 마크다운 파일을 만드는 것은 **로컬 실행 내보내기 스크립트**(`scripts/export-learning-notes.ts`)로 처리 — DB의 `LearningNote`를 읽어 종류별(증권사/헤지펀드/은행) 하위 폴더에 마크다운으로 쓴다. 자동 스케줄이 아니라 필요할 때 로컬에서 실행.

### 1.3 지식 distill 과정

주간 배치가 그 주 누적된 `ExternalConsensus` 데이터 + 관련 뉴스 인용을 LLM에 넘겨 "이 소스는 어떤 지표를 어떤 논리로 해석해 이런 결론에 도달했는가"를 한국어로 요약, `LearningNote`에 저장(소스 종류·기관명 태그).

## 2. 리포트 품질 개선

- `src/lib/narrative.ts`의 프롬프트를 "지표 나열형"에서 **원인 → 결과 → 향후 자금 흐름 전망** 구조로 강제. 핵심 요약 문단을 반드시 포함.
- 문장 자체가 쉬워야 한다는 규칙을 프롬프트에 명시(괄호 풀이 금지, 전문용어 최소화, 짧고 명확한 문장).
- 생성 직후 LLM이 자기 문장을 재검토해 어려우면 재작성하는 자가검수 패스 추가(1회, 무한루프 방지).
- 축적된 `LearningNote`를 narrative 프롬프트 컨텍스트로 주입 — 실제 전문가 사고방식을 반영한 서술.
- **이 구성요소는 서술 레이어(`narrative.ts`)만 건드린다.** 채점 엔진(숫자 계산)에는 영향 없음 — 안전.

## 3. 자율 자가진단 · 자가수정 · 배포 파이프라인

### 3.1 트리거

기존 크론 인프라(`cron-job.org` → API 라우트 호출, GH Actions/Vercel crons는 신뢰성 문제로 이미 배제된 전례 있음)와 같은 방식으로 새 API 라우트를 만들어 등록:
- 매일: 리포트 생성 직후 자가진단
- 주간: 누적 데이터 기반 패턴 분석 + 지식 distill(1.3) + 심층 자가진단

### 3.2 자가진단 단계

- `verdict-outcomes`(적중/불일치) 데이터와 섹션 1의 외부 컨센서스 데이터를 대조해 괴리 패턴 탐지
- 알려진 버그 클래스 자동 점검(이번 감사에서 실제로 나왔던 패턴들 — 한글 키워드 substring 오탐, LLM thinking-token 예산 부족으로 인한 응답 절단, `asOf` 날짜 threading 오류 등)

### 3.3 이상 발견 시 — 자동수정 파이프라인

1. Vercel Sandbox 같은 격리 실행 환경에서 LLM이 원인 분석 → 코드 수정 시도
2. `npm test` + `npx tsc --noEmit` 자동 실행
3. **보호 파일**(`run.ts`의 `runDailyAnalysis`, `pipeline.ts`의 `runDailyPipeline`, `pure.ts`의 `scoreStep1~8`/`WEIGHTS`/`decisionFromScore`) 변경분이 있으면 그 자체로 즉시 실패 처리 — diff에 보호 파일이 포함되면 병합 자체를 거부
4. 전부 통과 → 자동 커밋 · master 병합 · Vercel 자동배포 / 하나라도 실패 → 병합하지 않고 사람이 검토할 수 있는 draft PR로만 남김
5. **성공이든 실패든 Discord 알림**(기존 `src/lib/discord-alert.ts` 확장) — 무엇을 왜 고쳤는지, 실패했다면 왜 실패했는지 요약 포함

### 3.4 안전장치

- 하루 자동배포 횟수 상한 1회(폭주 방지)
- 모든 자동수정 시도를 `AutoFixLog`에 감사로그(무엇을·왜·결과·통과한 검사 항목)로 기록
- 킬스위치 환경변수(`AUTO_FIX_ENABLED=false`) — 문제 생기면 파이프라인 전체를 즉시 끌 수 있음
- 보호 파일 목록은 코드 상수로 하드코딩(설정 파일로 빼지 않음 — LLM이 설정값 자체를 우회 수정하는 걸 막기 위함)

## 4. 신규 DB 스키마 (요약)

```prisma
model ExternalConsensus {
  id         String   @id @default(cuid())
  sourceType String   // "13f" | "bis" | "domestic_broker" | "finnhub" | "news_quote"
  sourceName String   // 기관명(예: "Bridgewater", "NH투자증권")
  date       DateTime @db.Date
  payload    Json     // 소스별 원본 데이터
  createdAt  DateTime @default(now())
}

model LearningNote {
  id          String   @id @default(cuid())
  category    String   // "증권사" | "헤지펀드" | "은행"
  sourceName  String
  summary     String   // distill된 해석 방법론(한국어)
  basedOn     Json     // 근거가 된 ExternalConsensus id 목록
  createdAt   DateTime @default(now())
}

model AutoFixLog {
  id            String   @id @default(cuid())
  detectedIssue String   // 자가진단이 발견한 문제 요약
  attemptedFix  String?  // 시도한 수정 내용(diff 요약)
  testsPassed   Boolean
  protectedFileTouched Boolean
  deployed      Boolean
  prUrl         String?  // 병합 안 됐을 때 draft PR 링크
  createdAt     DateTime @default(now())
}
```

## 5. 테스트 전략

- 신규 순수 함수(distill 로직, 괴리 탐지 로직 등)는 기존 관례대로 DB 접근 없는 pure 모듈로 분리해 단위테스트(`vitest`, CI에서 시크릿 없이 실행 가능해야 함 — 기존 `.github/workflows/test.yml` 제약과 동일)
- 자동수정 파이프라인 자체는 프로덕션에 영향 주기 전 **드라이런 모드**로 먼저 검증(실제 커밋·배포 없이 진단→수정 시도→테스트까지만 실행해 로그 확인)
- 보호 파일 가드는 반드시 실패 케이스(보호 파일을 일부러 건드리는 fixture)로 단위테스트

## 6. 다음 단계 (이번 프로젝트 범위 밖)

- 채점 엔진(`runDailyAnalysis`/`runDailyPipeline`/`pure.ts`) 자체의 전면 개편 — 사용자가 언급한 대로 완전히 별도 프로젝트
- 토스·한국투자 API 실제 연동 — 사용자가 키를 제공하면 그때 별도 태스크로 진행
