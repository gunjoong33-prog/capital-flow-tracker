import { runDailyAnalysis } from "@/lib/scoring/run";
import { fetchAllSectors } from "@/lib/sources/yahoo";
import { db } from "@/lib/db";
import { BIG_TECH_TICKERS } from "@/lib/sources/types";
import { ReportView } from "@/components/ReportView";
import { SiteNav } from "@/components/SiteNav";
import { FreshnessBanner } from "@/components/FreshnessBanner";
import { checkReportFreshness } from "@/lib/report-freshness";
import { kstToday } from "@/lib/date";

export const dynamic = "force-dynamic"; // 매번 최신 DB 값으로 계산 — 캐시하면 안 됨

// 홈은 매번 새로 계산하지만, Groq(빅테크 원인)·외부 스크래핑(기관·내부자 매집)까지
// 접속마다 반복하면 무료 티어 소진·응답 지연이 생기므로 하루 1회(파이프라인)만 돌린 결과를
// 오늘자 DB에서 읽어 재사용한다. 나머지(가격·점수 등)는 live 값을 그대로 쓴다.
interface PersistedDetails {
  step5BigTech?: { value: string }[];
  step7Institutional?: { label: string; criterion: string; value: string; met: boolean | null }[];
  step7Summary?: string;
  comprehensiveReport?: string;
}

async function getPersistedDetails(date: string): Promise<PersistedDetails | null> {
  const persisted = await db.dailyReport.findUnique({ where: { date: new Date(date) } });
  return (persisted?.details as PersistedDetails | null) ?? null;
}

/** 빅테크 등락 원인만 뽑아 티커별 맵으로 재구성한다(가격은 live 값을 쓰도록 원인 문구만 필요). */
function extractBigTechReasons(details: PersistedDetails | null): Record<string, string> {
  const rows = details?.step5BigTech;
  if (!rows || rows.length !== BIG_TECH_TICKERS.length) return {};
  const reasons: Record<string, string> = {};
  rows.forEach((row, i) => {
    const parts = row.value.split(" — ");
    reasons[BIG_TECH_TICKERS[i]] = parts[parts.length - 1];
  });
  return reasons;
}

async function getReport() {
  let sectors: { name: string; return5d: number; volumeRatio: number }[] = [];
  let missingSectorLabels: string[] = [];
  try {
    const result = await fetchAllSectors();
    sectors = result.sectors;
    missingSectorLabels = result.errors.map((e) => e.sector);
  } catch {
    // 섹터 조회 전체 실패해도 나머지 분석은 계속 — 6단계만 빈 값으로(details.step6가 확인 못함 처리)
  }

  const today = kstToday();
  const persistedDetails = await getPersistedDetails(today);

  const report = await runDailyAnalysis({
    sectors: sectors.map((s) => ({ name: s.name, return5d: s.return5d, volumeRatio: s.volumeRatio })),
    missingSectorLabels,
    bigTechReasons: extractBigTechReasons(persistedDetails),
  });

  // 기관·내부자 매집 표·종합판단은 오늘자 파이프라인이 이미 계산해둔 걸 그대로 갖다 붙인다
  // (institutional-signals.ts는 live 경로에서 호출 안 해서 여기선 항상 "확인 못함" 자리표시자뿐임).
  if (persistedDetails?.step7Institutional) {
    report.details.step7Institutional = persistedDetails.step7Institutional;
  }
  if (persistedDetails?.step7Summary) {
    report.details.step7Summary = persistedDetails.step7Summary;
  }
  if (persistedDetails?.comprehensiveReport) {
    report.details.comprehensiveReport = persistedDetails.comprehensiveReport;
  }

  return report;
}

export default async function ReportPage() {
  const [report, freshness] = await Promise.all([getReport(), checkReportFreshness()]);

  // timeZone을 명시하지 않으면 서버 기본 시간대(Vercel은 UTC)를 타서, KST 00~09시 접속자에게는
  // 화면에 표시되는 날짜가 실제 한국 날짜보다 하루 전으로 보이는 문제가 있었다(외부 교차검증 지적,
  // 코드 확인 결과 실제로 존재). 이 사이트는 한국 사용자 대상이라 항상 KST 기준으로 표시한다.
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Seoul",
  });

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto max-w-3xl space-y-4">
        <SiteNav active="report" />
        <FreshnessBanner freshness={freshness} />
        <ReportView dateLabel={today} report={report} details={report.details} />
      </main>
    </div>
  );
}
