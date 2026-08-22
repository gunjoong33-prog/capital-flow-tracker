# 데일리 리포트·옵시디언 업로드 실패 즉시 감지 → Discord 알림

## 배경

`오늘의 리포트`(데일리 파이프라인)와 옵시디언 vault 업로드가 실패해도, 지금은 사용자가 사이트를
직접 열어보거나 로그를 뒤지기 전까지 알 방법이 없다. 이번 작업은 이 실패를 **즉시(push)** 감지해
기존 Discord 웹훅으로 보고하는 것.

## 조사 결과 — 이미 있는 인프라

- `src/lib/discord-alert.ts`: `sendReportUploadedAlert`(새 리포트 저장 시), `sendHealthCheckAlert`
  (범용 경고, 자체 실패는 조용히 삼킴 — 마지막 보루라 여기서 또 던지면 갈 곳이 없음) 이미 존재.
- `src/app/api/cron/health-check`: cron-job.org가 데일리 크론(08:50) 이후(09:10)에 호출. "오늘
  리포트 자체가 없음" + "sourceErrors에 Discord알림 실패 기록 있음" 두 가지 체크.
- 옵시디언 업로드는 이중 경로: 리포트 저장 직후 즉시 시도(`exportDailyReportNow`, pipeline.ts:396)
  + 09:30 안전망 크론(`/api/cron/obsidian-export`, 최근 60일 재확인).

## 확정된 버그 (수정 대상)

`pipeline.ts`가 `dataCompleteness: asJson({ sourceErrors })`를 `db.dailyReport.upsert`에 담아
**377번 줄에서 한 번만** DB에 쓴다. 그런데 옵시디언export(398)·Discord알림(404)·Notion 하위DB
(413)·Notion 캘린더(423)·주기별리포트(437) 실패 기록은 전부 그 이후 시점에 같은 `sourceErrors`
배열에 push만 될 뿐, DB에 다시 쓰이지 않는다 — 함수 끝까지 추가 update가 없다. 그 결과
health-check의 "Discord알림 실패" 체크는 **DB에서 이 항목을 영원히 볼 수 없어 항상 무통과**하는
죽은 코드다.

## 설계

### 1. 버그 수정 — `src/lib/pipeline.ts`

함수 끝(현재 429번 줄 근처, `return` 직전)에 최종 `sourceErrors`를 한 번 더 DB에 반영:

```ts
await db.dailyReport.update({
  where: { date: new Date(today) },
  data: { dataCompleteness: asJson({ sourceErrors }) },
});
```

목적은 감사 흔적(나중에 "그날 뭐가 실패했는지" DB로 확인 가능)이지, 알림 트리거는 아래 2·3번이
전담한다 — 이 업데이트 자체가 실패해도(DB 순단 등) 알림 로직과는 독립이라 문제 없음.

### 2. 데일리 파이프라인 전체 실패 → 즉시 알림 — `src/app/api/cron/daily/route.ts`

현재 catch 블록은 500 JSON만 반환하고 끝. `sendHealthCheckAlert` 호출 추가:

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await sendHealthCheckAlert(`데일리 파이프라인 전체 실패: ${message}`);
  return NextResponse.json({ error: message }, { status: 500 });
}
```

### 3. 옵시디언 안전망 크론 실패 → 즉시 알림(진단 정보 포함) — `src/app/api/cron/obsidian-export/route.ts`

- `GITHUB_EXPORT_TOKEN` 없어서 조기 반환하는 경로(40번 줄)에도 알림 추가.
- `errors` 배열이 채워지면(하나라도 `upsertFile`이 "error" 반환) 응답 직전에 알림 추가 — 실패한
  경로 목록과 건수를 요약해서 보낸다.
- **진단 정보 부족 문제 발견 및 수정**: `src/lib/obsidian-export.ts`의 `upsertObsidianFile`이
  실패해도 지금은 `"error"` 문자열만 반환하고 실제 원인(HTTP 상태 코드·GitHub 응답 본문)은
  버려진다 — 알림에 "5건 실패"만 뜨고 401(토큰 무효)인지 403(레이트리밋)인지 500(GitHub 장애)인지
  알 수 없어 자동조사 필요성이 그대로 남는다. 반환 타입을 `{ status: "created"|"updated"|
  "unchanged"|"error"; detail?: string }`로 바꿔 실패 시 `detail`에 `${res.status} ${본문 일부}`를
  담는다. Discord 메시지에는 실패 경로별 detail을 최대 5건까지 붙이고(Discord 메시지 2000자 제한
  고려), 5건 초과면 "외 N건 더"로 요약한다.

### 커버 범위 정리

| 상황 | 알림 시점 | 담당 |
|---|---|---|
| 데일리 파이프라인 자체가 죽음(예외/타임아웃) | 즉시 | daily/route.ts catch |
| 리포트는 저장됐지만 옵시디언 export가 같은 요청 안에서만 실패 | 알림 안 함(정상 재시도 경로) | — |
| 09:30 안전망 크론까지 실패(=최종 실패 확정) | 즉시 | obsidian-export/route.ts |
| cron-job.org가 데일리 크론 자체를 못 부름(코드 실행 안 됨) | 최대 09:10까지 지연 | health-check(기존, 그대로 유지) |
| Discord 웹훅 알림 전송 자체가 실패(URL 무효화 등) | 최대 09:10까지 지연, DB 기록은 버그 수정 후 정상 작동 | health-check(기존, 그대로 유지) |

즉시 알림(2·3번)과 폴링 백스톱(health-check)은 서로 다른 실패 모드를 잡아 역할이 겹치지 않는다.

## 테스트 계획

이 프로젝트에 웹훅/크론 라우트를 대상으로 한 vitest가 없다(`discord-alert.ts`도 기존에 테스트
없음 — 외부 부수효과라 단위테스트 대상으로 안 삼아온 기존 관례). 배포 후 수동 검증으로 대체:

1. `GITHUB_EXPORT_TOKEN`을 Vercel 환경변수에서 임시로 잘못된 값으로 바꾼다.
2. `/api/cron/obsidian-export`를 수동 호출(cron-job.org 인증 헤더 포함)해 강제로 실패시킨다.
3. Discord 채널에 실패 알림이 실제로 오는지 확인한다.
4. `GITHUB_EXPORT_TOKEN`을 원래 값으로 복구한다.

## 추가 — 알림 문구 비전공자 수준으로 번역 (2026-08-22, 로컬 테스트 후 사용자 요청)

로컬 테스트에서 실제 알림 문구가 `GET 401: {"message":"Bad credentials",...}`처럼 GitHub API
원문(HTTP 상태 코드 + JSON)을 그대로 보여준다는 게 확인됨 — 비전공자는 못 알아봄. DB 감사
흔적(`dataCompleteness`)은 원문 그대로 유지하되(정확한 디버깅용), **Discord 알림에만** 흔한
패턴을 쉬운 한국어 문장으로 바꾸는 번역 함수를 `obsidian-export/route.ts`에 추가한다.

```ts
function friendlyDetail(detail: string): string {
  if (/^(GET|PUT) 401/.test(detail)) return "GitHub 접속 열쇠(토큰)가 잘못됐거나 만료됨";
  if (/^(GET|PUT) 403/.test(detail)) return "GitHub 요청이 너무 잦아 잠깐 막힘(사용량 제한) 또는 권한 부족";
  if (/^(GET|PUT) 5\d\d/.test(detail)) return "GitHub 서버 자체에 일시적 문제 발생";
  return `GitHub 연결 문제(${detail.slice(0, 80)})`;
}
```

`formatErrorAlert`가 `e.detail` 대신 `friendlyDetail(e.detail)`을 쓰도록 바꾼다. 데일리 파이프라인
전체 실패 알림(`daily/route.ts`)의 `err.message`는 원인이 너무 다양해(Groq/Prisma/네트워크 등)
일반화된 매핑이 불가능해 범위에서 제외 — 필요해지면 실제로 반복되는 패턴이 쌓인 뒤에 추가한다.

## 추가 — 옵시디언 실패 알림에 "재시도" 버튼 (2026-08-22, 사용자 요청)

**조사 결과**: `DISCORD_WEBHOOK_URL`을 ai-macro-company와 이미 공유 중인데("같은 채널 재사용"),
그 프로젝트가 이미 이 웹훅(=같은 Discord Application, 일명 "크론봇")으로 버튼 달린 알림 전송 +
클릭 처리를 하고 있다(`sendCronStaleAlert`/`retry-daily-cron`,
`ai-macro-company/src/app/api/discord/interactions/route.ts`). Discord 개발자 포털에서 새로
Application을 만들 필요가 전혀 없다 — 그 Application의 Interactions Endpoint URL이 이미
ai-macro-company 쪽 라우트로 등록돼 있어, 이번 것도 그 라우트에 분기 하나만 추가하면 된다.

**변경 범위 (두 저장소):**

1. **capital-flow-tracker** — `src/lib/discord-alert.ts`: `postToDiscord`가 `components` 옵션 인자를
   받게 확장, 새 함수 `sendObsidianExportFailureAlert(message)`가 `custom_id: "retry-obsidian-export"`
   버튼을 붙여 보낸다. `src/app/api/cron/obsidian-export/route.ts`가 실패 알림을 이 함수로 바꿔 호출.
2. **ai-macro-company** — `src/app/api/discord/interactions/route.ts`: `retryDailyCron`과 같은
   패턴으로 `retryObsidianExport()` 추가, `https://capital-flow-tracker.vercel.app/api/cron/
   obsidian-export`를 새 환경변수 `CAPITAL_FLOW_TRACKER_CRON_SECRET`으로 인증 호출. 커스텀ID→핸들러
   룩업 테이블로 분기(기존 if 하나 늘리는 대신 확장 가능한 구조로).

**필요한 새 시크릿**: ai-macro-company Vercel 프로덕션에 `CAPITAL_FLOW_TRACKER_CRON_SECRET`
(capital-flow-tracker의 실제 `CRON_SECRET`과 동일 값) 추가 — 프로덕션 시크릿 등록은 자동 모드
분류기가 막을 수 있어(2026-08-22 GITHUB_EXPORT_TOKEN 테스트 때 실측), 막히면 사용자에게 직접
등록을 요청한다.

**범위 밖**: `retry-daily-cron`을 포함해 기존 ai-macro-company 기능은 건드리지 않는다(룩업 테이블
추가만, 기존 분기 로직 동작 그대로 유지).

## 정정 — 웹훅으론 버튼 못 보냄, 봇으로 전환 (2026-08-22, 실측 후 수정)

실제로 테스트해보니 `DISCORD_WEBHOOK_URL`(Incoming Webhook)로 보낸 버튼이 화면에 안 떴다. Discord
공식 문서 확인 결과: "non-owned webhooks cannot send interactive components, and the `components`
field will be ignored" — Application이 소유하지 않은 일반 웹훅은 요청은 성공(204)하지만 버튼만
조용히 무시된다. `sendCronStaleAlert`(ai-macro-company)도 같은 방식이라 실제로는 한 번도 작동한
적 없었을 가능성이 높다는 것도 이번에 확인.

**실제 적용한 수정**: `sendObsidianExportFailureAlert`만 웹훅 대신 Discord Bot API
(`POST /channels/{id}/messages`, `Authorization: Bot ...`)로 전환. 이를 위해 기존 "크론봇"
Application에 봇을 추가하고(사용자가 개발자 포털에서 직접 진행), 서버에 초대, 새 환경변수
`DISCORD_BOT_TOKEN`·`DISCORD_CHANNEL_ID`를 capital-flow-tracker 프로덕션에 등록(2026-08-22 완료).
다른 알림 함수(`sendReportUploadedAlert`, `sendHealthCheckAlert`)는 버튼이 필요 없어 웹훅 그대로 둠.

## 되돌림 — 재시도 버튼 기능 전체 폐기 (2026-08-22, 사용자 결정)

봇 초대(OAuth2 code grant 설정, 서버 ID/채널 ID 혼동), 인터랙션 라우팅(ai-macro-company 크로스
저장소 호출) 등 여러 단계에서 계속 막혀 디버깅에 시간이 많이 들었다 — 사용자가 "ai-macro-company는
보류, 코드 자체 삭제"로 결정해 위 "재시도 버튼" 기능(바로 위 두 절) 전체를 되돌렸다:

- **capital-flow-tracker**: `sendObsidianExportFailureAlert` 함수 삭제, `obsidian-export/route.ts`가
  다시 `sendHealthCheckAlert(formatErrorAlert(errorDetails))`를 직접 호출하도록 원복(버튼 없이 텍스트
  알림만, ①·②·③ 단계는 그대로 유지 — 진단 정보 포함 텍스트 알림은 살아있음). `postToDiscord`의
  `components` 옵션 인자도 제거(더 쓰는 곳 없음). 프로덕션 Vercel의 `DISCORD_BOT_TOKEN`·
  `DISCORD_CHANNEL_ID`도 삭제.
- **ai-macro-company**: 손대지 않음(보류) — `retryObsidianExport`/`RETRY_HANDLERS` 룩업 테이블 추가
  건은 별도로 그 저장소에서 되돌릴지 결정 필요(이 스펙 범위 밖).

**남겨두는 이유**: 위 두 절(웹훅이 인터랙티브 컴포넌트를 못 보낸다는 Discord 공식 문서 근거, OAuth2
code grant 문제, 서버ID/채널ID 구분 등)은 나중에 이 기능을 다시 시도할 때 같은 시행착오를 반복하지
않게 해주는 조사 기록이라 삭제하지 않고 남긴다.

## 범위 밖(하지 않는 것)

- health-check 크론 시각 변경 없음(09:10 유지) — 즉시 알림 경로가 생겨서 재조정할 이유가 없어짐.
- 옵시디언export의 같은 요청 내 실패(1차 시도)는 알림 대상 아님 — 09:30 안전망이 정상 동작하는
  한 이건 예상된 일시적 상태.
