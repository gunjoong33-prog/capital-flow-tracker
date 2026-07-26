import { runDailyAnalysis } from "@/lib/scoring/run";
import { fetchAllSectors } from "@/lib/sources/yahoo";
import { getManualInputsForDate } from "@/lib/manual-inputs";
import { db } from "@/lib/db";
import { ReportView } from "@/components/ReportView";
import { SiteNav } from "@/components/SiteNav";

export const dynamic = "force-dynamic"; // 매번 최신 DB 값으로 계산 — 캐시하면 안 됨

async function getReport() {
  let sectors: { name: string; return5d: number; volumeRatio: number }[] = [];
  try {
    sectors = await fetchAllSectors();
  } catch {
    // 섹터 조회 실패해도 나머지 분석은 계속 — 6단계만 빈 값으로
  }

  const today = new Date().toISOString().slice(0, 10);
  const manualInputs = await getManualInputsForDate(today);

  const report = await runDailyAnalysis({
    domesticWeightHigh: manualInputs.domesticWeightHigh,
    fearGreed: manualInputs.fearGreed,
    sectors: sectors.map((s) => ({ name: s.name, return5d: s.return5d, volumeRatio: s.volumeRatio })),
  });

  // 빅테크 등락 원인은 Gemini를 하루 1회(파이프라인)만 호출해 만든다 — 홈은 매번 새로 계산하지만
  // 이 Gemini 호출까지 매번 반복하면 무료 티어를 금방 소진하므로, 오늘자 파이프라인이 이미 돌았다면
  // 그 결과(step5BigTech, 원인 포함)를 그대로 재사용한다.
  const persisted = await db.dailyReport.findUnique({ where: { date: new Date(today) } });
  const persistedStep5BigTech = (persisted?.details as { step5BigTech?: unknown } | null)?.step5BigTech;
  if (persistedStep5BigTech) {
    report.details.step5BigTech = persistedStep5BigTech as typeof report.details.step5BigTech;
  }

  return report;
}

export default async function Home() {
  const report = await getReport();

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto max-w-3xl space-y-4">
        <SiteNav active="home" />
        <ReportView dateLabel={today} report={report} details={report.details} />
      </main>
    </div>
  );
}
