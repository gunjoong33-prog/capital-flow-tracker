import { db } from "@/lib/db";
import { ReportView, type ReportViewData } from "@/components/ReportView";
import { SiteNav } from "@/components/SiteNav";
import { kstToday } from "@/lib/date";
import type { StepDetails } from "@/lib/scoring/types";

// 예전엔 접속마다 runDailyAnalysis()·fetchAllSectors()(Yahoo 10회)를 실시간으로 다시 돌렸다 —
// 그 결과 화면 점수·노션 기록·주간 리포트 숫자가 서로 다른 "정답 3개" 문제가 있었고(외부 감사
// 지적, 실제 확인), 6단계는 원자료가 저장 안 돼 백테스트도 불가능했다. 이 사이트가 스스로 내건
// 약속도 "매일 오전 9시(KST) 갱신"이라 실시간 재계산은 애초에 그 약속과 안 맞았다. 09시 파이프라인이
// 저장한 DailyReport 스냅샷을 읽기 전용으로 쓰고, 파이프라인이 저장 직후 revalidatePath로
// 무효화하므로 캐시 시차 없이 최신 반영된다(pipeline.ts 참고).
//
// 안전장치: revalidatePath는 파이프라인(배포된 앱 내부)에서만 호출된다 — scripts/backfill-*.ts,
// reapply-*.ts처럼 로컬 tsx로 DB만 직접 고치는 스크립트는 배포된 앱의 캐시를 무효화할 방법이
// 없다(같은 프로세스가 아니라서 revalidatePath를 불러도 효과가 없다). 그런 스크립트 실행 뒤
// 코드 재배포를 안 하면 화면이 stale할 수 있다는 지적이 있어, 5분 ISR을 안전망으로 둔다.
export const revalidate = 300;
async function getReportRow() {
  const today = kstToday();
  const todayRow = await db.dailyReport.findUnique({ where: { date: new Date(today) } });
  if (todayRow) return todayRow;
  // 크론이 스킵(휴장일 등)됐거나 아직 미실행이면 가장 최근 리포트로 대체 — 빈 화면 대신 "며칠 전
  // 데이터"임을 아래 dateLabel(marketDate 병기)로 보여준다.
  return db.dailyReport.findFirst({ orderBy: { date: "desc" } });
}

export default async function ReportPage() {
  const reportRow = await getReportRow();

  if (!reportRow) {
    return (
      <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
        <main className="mx-auto max-w-3xl space-y-4">
          <SiteNav active="report" />
          <p className="text-sm text-zinc-400">아직 생성된 리포트가 없습니다.</p>
        </main>
      </div>
    );
  }

  // 저장된 날짜(date-only, UTC 자정)를 그대로 포맷 — Asia/Seoul로 다시 해석하면 자정 UTC가
  // 다음날로 밀릴 수 있어 calendar/[date] 페이지와 같은 방식(UTC)으로 표시한다.
  const dateOnlyLabel = reportRow.date.toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "UTC",
  });
  // marketDate(실제 데이터 기준 미국장 마감 거래일)가 리포트 생성일과 다르면(휴장일 등) 병기 —
  // "8/1 리포트인데 실제로는 7/31 데이터"처럼 두 날짜가 섞여 혼동되는 걸 막는다(외부 감사 지적).
  const marketDateLabel = reportRow.marketDate?.toISOString().slice(0, 10);
  const dateOnlyStr = reportRow.date.toISOString().slice(0, 10);
  const dateLabel =
    marketDateLabel && marketDateLabel !== dateOnlyStr ? `${dateOnlyLabel} · 기준: ${marketDateLabel} 미국장 마감` : dateOnlyLabel;

  const reportData: ReportViewData = {
    step1: reportRow.step1 as unknown as ReportViewData["step1"],
    step2: reportRow.step2 as unknown as ReportViewData["step2"],
    step3: reportRow.step3 as unknown as ReportViewData["step3"],
    step4: reportRow.step4 as unknown as ReportViewData["step4"],
    step5: reportRow.step5 as unknown as ReportViewData["step5"],
    step6: reportRow.step6 as unknown as ReportViewData["step6"],
    step7: reportRow.step7 as unknown as ReportViewData["step7"],
    step8: reportRow.step8 as unknown as ReportViewData["step8"],
  };

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto max-w-3xl space-y-4">
        <SiteNav active="report" />
        <ReportView dateLabel={dateLabel} report={reportData} details={reportRow.details as unknown as StepDetails | null} />
      </main>
    </div>
  );
}
