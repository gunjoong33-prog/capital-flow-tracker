import { runDailyAnalysis } from "@/lib/scoring/run";
import { fetchAllSectors } from "@/lib/sources/yahoo";
import { ReportView } from "@/components/ReportView";
import Link from "next/link";

export const dynamic = "force-dynamic"; // 매번 최신 DB 값으로 계산 — 캐시하면 안 됨

async function getReport() {
  let sectors: { name: string; return5d: number; volumeRatio: number }[] = [];
  try {
    sectors = await fetchAllSectors();
  } catch {
    // 섹터 조회 실패해도 나머지 분석은 계속 — 6단계만 빈 값으로
  }

  // TODO(4단계 후속): newsCount·jpyVolSpike·fearGreed·domesticWeightHigh는
  // 지금은 기본값이다. 실제로는 매일 수동 입력하거나(뉴스·심리) LLM 판단을 붙여야 한다.
  // 지금 이 페이지의 목적은 "계산 로직 + 실제 DB 데이터"가 맞물려 도는지 확인하는 것.
  return runDailyAnalysis({
    newsCountLast7Days: 0,
    hasBigEventNext14Days: false,
    domesticWeightHigh: false,
    jpyVolSpike: false,
    fearGreed: null,
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
        <nav className="flex gap-4 text-sm text-zinc-500">
          <span className="text-zinc-100">오늘의 리포트</span>
          <Link href="/calendar" className="hover:text-zinc-200">캘린더</Link>
          <Link href="/reports/weekly" className="hover:text-zinc-200">주기별 리포트</Link>
        </nav>
        <ReportView dateLabel={today} report={report} details={report.details} />
      </main>
    </div>
  );
}
