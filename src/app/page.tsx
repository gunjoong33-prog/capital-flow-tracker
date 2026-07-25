import { runDailyAnalysis } from "@/lib/scoring/run";
import { fetchAllSectors } from "@/lib/sources/yahoo";
import { getManualInputsForDate } from "@/lib/manual-inputs";
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

  return runDailyAnalysis({
    newsCountLast7Days: manualInputs.newsCountLast7Days,
    hasBigEventNext14Days: manualInputs.hasBigEventNext14Days,
    domesticWeightHigh: manualInputs.domesticWeightHigh,
    jpyVolSpike: manualInputs.jpyVolSpike,
    fearGreed: manualInputs.fearGreed,
    sectors: sectors.map((s) => ({ name: s.name, return5d: s.return5d, volumeRatio: s.volumeRatio })),
  });
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
