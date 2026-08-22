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

### 3. 옵시디언 안전망 크론 실패 → 즉시 알림 — `src/app/api/cron/obsidian-export/route.ts`

- `GITHUB_EXPORT_TOKEN` 없어서 조기 반환하는 경로(40번 줄)에도 알림 추가.
- `errors` 배열이 채워지면(하나라도 `upsertFile`이 "error" 반환) 응답 직전에 알림 추가 — 실패한
  경로 목록과 건수를 요약해서 보낸다.

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

## 범위 밖(하지 않는 것)

- health-check 크론 시각 변경 없음(09:10 유지) — 즉시 알림 경로가 생겨서 재조정할 이유가 없어짐.
- 옵시디언export의 같은 요청 내 실패(1차 시도)는 알림 대상 아님 — 09:30 안전망이 정상 동작하는
  한 이건 예상된 일시적 상태.
