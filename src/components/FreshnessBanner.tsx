import type { ReportFreshness } from "@/lib/report-freshness";

/** 오늘자 자동 파이프라인 실행 여부를 알리는 배너 — 정상(오늘자 있음)이면 아무것도 렌더링하지 않는다. */
export function FreshnessBanner({ freshness }: { freshness: ReportFreshness }) {
  if (freshness.hasTodayReport) return null;

  const message = freshness.lastReportDate
    ? `⚠️ 오늘(${freshness.todayStr})자 자동 리포트가 아직 생성되지 않았습니다 — 마지막 갱신: ${freshness.lastReportDate}(${freshness.hoursSinceLastReport}시간 전). 화면의 개별 지표는 실시간 계산되지만, 뉴스 판정 등 일부는 어제 값일 수 있습니다.`
    : `⚠️ 자동 리포트 생성 이력이 없습니다.`;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
      {message}
    </div>
  );
}
