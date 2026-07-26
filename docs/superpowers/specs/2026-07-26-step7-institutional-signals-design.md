# 7단계: 기관·내부자 매집 신호 지표 추가

## 배경

7단계(심리 필터)에 "기관/거물 투자자의 자본 흐름을 거시적으로 조망"하는 지표를 추가하고 싶다는 요청에서 시작했다. 처음 후보로 검토한 WhaleWisdom·FolioObs는 둘 다 기각했다:

- **WhaleWisdom**: 무료 티어는 최근 8분기(현재 분기 제외)만 접근 가능하고 섹터 스크리닝은 유료 페이지로 안내된다. 근본적으로 13F 자체가 분기 공시(45일 지연)라 매일 갱신되는 지표와 주기가 안 맞는다. → **7단계에서 완전히 제외**.
- **FolioObs**: 로그인 없이 보이는 페이지엔 API/RSS가 없고 섹터별 집계 데이터도 없다(개별 종목 Top 20 리스트뿐). 클라이언트 JS 번들을 조사해 Supabase 백엔드와 공개 anon 키를 찾았고, 실제로 이 키로 `holdings`, `ark_daily_trades` 등 테이블에 직접 REST 쿼리해 전체 데이터를 받아오는 것까지 확인했다. 하지만 이건 웹사이트가 공개로 보여주는 범위(Top 20)를 훨씬 넘어서는 데이터이고, 그들의 UI/구독 등급 로직을 우회하는 것이라 사용하지 않기로 했다. → **FolioObs 자동화도 기각**.

대신 자유 텍스트 수동 입력으로 방향을 잡았다가, "정말 자동화할 방법이 없는지" 재조사한 끝에 **Dataroma.com**(슈퍼 투자자 13F 활동)과 **OpenInsider.com**(SEC Form 4 내부자거래)을 찾았다. 둘 다:
- robots.txt가 없거나(Dataroma) 알려진 SEO봇만 차단(OpenInsider)하고 일반 요청은 허용
- 순수 서버 렌더링 HTML 표(SPA 아님) — 정규식 파싱으로 충분
- 커뮤니티에서 널리 알려진 무료·공개 도구(유료 SaaS를 우회하는 게 아니라 애초에 무료로 설계된 서비스)

이 두 사이트로 자동화하는 것이 최종 방향이다.

## 목표

- 7단계에 기관(슈퍼 투자자)·내부자 매매 동향을 자동으로 수집·표시하는 행 4개 + 전단계(5·6단계) 분석과의 일치 여부를 자동 판정하는 행 1개를 추가한다.
- 기존 7단계 지표(양쪽 동시 과열, 공포 구간)는 그대로 유지하고, 새 행들은 그 위에 추가한다.
- 7단계는 원래 합산 점수에 반영되지 않는 단계이므로, 새 지표들도 `met: null`(정보성)로 처리하고 8단계 점수 계산에는 관여하지 않는다.
- 데이터 정직성 원칙 유지: 파싱 실패·매칭 불가 시 지어내지 않고 "확인 못함"류로 명시.

## 데이터 소스

### `src/lib/sources/dataroma.ts` — `fetchSuperInvestorActivity()`
- `https://www.dataroma.com/m/allact.php?typ=a` (최근 활동, 매수/매도 전체) 파싱
- 반환: `{ manager: string; ticker: string; action: "buy" | "sell" | "new" | "exit"; quarter: string }[]`
- `news-feeds.ts`와 동일한 원칙: 정규식 기반 HTML 테이블 파싱, User-Agent 헤더 포함, 실패 시 에러를 던지고 상위에서 `Promise.allSettled`로 흡수

### `src/lib/sources/openinsider.ts` — `fetchInsiderTrades()`
- `http://openinsider.com/latest-insider-trading` 파싱
- 반환: `{ ticker: string; insiderName: string; title: string; tradeType: "buy" | "sell"; valueUsd: number | null; filingDate: string }[]`
- 동일한 파싱 원칙. 표 컬럼(Ticker/Insider/Title/Trade Date/Value 등)을 정규식으로 추출.

두 소스 다 별도 API 키 불필요, 무료.

## 신규 로직: `src/lib/institutional-signals.ts`

`bigtech-reasons.ts`와 같은 위치의 책임 분리 원칙(LLM/외부 호출은 run.ts 밖에서 처리하고 run.ts는 결과만 조합)을 따르되, **이 지표는 LLM이 필요 없다** — 이미 구조화된 사실 데이터(누가 무엇을 샀다)라 2~6단계 종합판단처럼 규칙 기반으로 문장화하면 충분하다. Gemini 무료 티어 한도(일 20회)를 추가로 소모하지 않는다는 것도 장점.

`computeInstitutionalSignals(bigTechTickers, qualifyingSector)` 함수가 하는 일:

1. `fetchSuperInvestorActivity()` + `fetchInsiderTrades()`를 병렬 호출
2. **슈퍼 투자자 포트폴리오** 텍스트: 매니저 기준 최근 신규매수/전량매도 상위 3~5건을 결정론적으로 한국어 문장화 (예: "버크셔 해서웨이(버핏) NVDA 신규매수, ...")
3. **종목별 기관 지분 분석** 텍스트: 같은 데이터를 종목 기준으로 재집계 — 이번 분기 2명 이상이 동시 매수/매도한 종목이 있으면 "컨센서스 종목"으로 강조
4. **섹터 및 자금 흐름**: 활동에 등장한 티커들을 섹터로 매핑해 집계
   - 신규 함수 `lookupSector(ticker)` (Yahoo Finance 프로필 조회, `sector`/`industry` 필드) → 우리 `SECTOR_LABELS` 10개 카테고리로 매핑하는 룩업 테이블
   - 매핑 안 되는 티커는 무시(억지로 분류하지 않음)
   - 가장 많이 등장한 섹터를 "매집 섹터 후보"로 제시, 매핑 가능한 데이터가 아예 없으면 "분류 안 됨"
5. **내부자 거래** 텍스트: OpenInsider 데이터에서 금액 기준 상위 몇 건을 문장화
6. **전단계 일치 여부**: 활동에 등장한 티커 집합을 `BIG_TECH_TICKERS`(5단계)와 직접 비교, 4에서 나온 매집 섹터 후보를 `qualifyingSector`(6단계 충족 섹터)와 비교
   - 티커 또는 섹터 중 하나라도 일치하면 "일치(OOO)"
   - 데이터는 있지만 안 맞으면 "불일치 — 실제 매집: OOO"
   - 활동 데이터 자체가 없으면 "확인 안 됨"

반환 타입: `{ superInvestorSummary: string; stockConsensusSummary: string; sectorFlowSummary: string; insiderTradeSummary: string; matchResult: string; errors: string[] }`

## `run.ts` / `pipeline.ts` 연동

- `pipeline.ts`가 하루 1회(크론) `computeInstitutionalSignals(...)` 호출 → `runDailyAnalysis()`의 `manualInputs`에 결과를 실어 보냄 (5단계 빅테크 원인과 동일 패턴)
- `page.tsx`(홈)는 오늘자 DB에 이미 저장된 결과를 읽어서 재사용 — 매 요청마다 Dataroma/OpenInsider를 다시 긁지 않음
- `refresh-report.ts`도 동일하게 갱신 시 재계산

## 7단계 UI 변경 (`run.ts` details.step7, `StepCard`/`ReportView`)

기존 순서 위에 새 행 5개 추가(맨 위부터):

| label | criterion(고정) | value |
|---|---|---|
| 슈퍼 투자자 포트폴리오 | 거손/헤지펀드 매매 내역 | superInvestorSummary |
| 종목별 기관 지분 분석 | 종목 중심의 스마트머니 추적 | stockConsensusSummary |
| 섹터 및 자금 흐름 | 자금 유입/유출 동향 | sectorFlowSummary |
| 내부자 거래 | 기업 임원/대주주 매매 기록 | insiderTradeSummary |
| 전단계 섹터·종목과 일치 여부 | 5·6단계 분석과 비교 | matchResult |

그 아래 기존 "양쪽 동시 과열", "공포 구간" 행 그대로 유지. 모두 `met: null`(합산 제외 특성 유지).

## `?` 툴팁 업데이트

7단계 툴팁에 새 지표 설명 추가: Dataroma·OpenInsider가 각각 어떤 데이터를 주는지, 13F 시차(최대 45일) 특성, 왜 5·6단계와 대조하는지.

## 비고 / 범위 밖

- WhaleWisdom, FolioObs는 이 스펙에서 완전히 제외.
- 섹터 매핑은 근사치다 — Yahoo 프로필의 sector/industry 필드와 우리 10개 카테고리가 1:1로 안 맞을 수 있어 매핑 실패를 정직하게 노출한다.
- Dataroma/OpenInsider 페이지 구조가 바뀌면 파싱이 깨질 수 있다 — `Promise.allSettled` + 에러 배열로 조용히 실패하지 않고 `sourceErrors`에 기록되도록 한다(5단계 빅테크 때 겪은 "조용한 실패" 교훈 반영).

## 검증 계획

- `npx tsc --noEmit`
- 로컬에서 `computeInstitutionalSignals` 단독 호출해 실제 파싱 결과 확인(디버그 스크립트)
- `refresh-report.ts`로 오늘자 DB 갱신 후 `/`, `/calendar/오늘날짜` 양쪽에서 시각 확인
- 브라우저로 7단계 새 행 5개 + 기존 행 정상 노출 확인
