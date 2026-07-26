import { runDailyAnalysis } from "@/lib/scoring/run";
import { fetchAllSectors } from "@/lib/sources/yahoo";
import { getManualInputsForDate } from "@/lib/manual-inputs";
import { db } from "@/lib/db";
import { BIG_TECH_TICKERS } from "@/lib/sources/types";
import { ReportView } from "@/components/ReportView";
import { SiteNav } from "@/components/SiteNav";

export const dynamic = "force-dynamic"; // 매번 최신 DB 값으로 계산 — 캐시하면 안 됨

/**
 * 빅테크 등락 원인은 Gemini를 하루 1회(파이프라인)만 호출해 만든다 — 홈은 매번 새로 계산하지만
 * 이 Gemini 호출까지 매번 반복하면 무료 티어를 금방 소진하므로, 오늘자 파이프라인이 이미 돌았다면
 * 그 결과에서 원인만 뽑아 재사용한다(가격·등락률은 live 값을 그대로 쓰도록 runDailyAnalysis 입력에
 * 넣어준다 — 종합판단의 "가장 크게 움직인 종목" 문장도 이 원인을 봐야 라이브 표와 문구가 일치한다).
 */
async function getPersistedBigTechReasons(date: string): Promise<Record<string, string>> {
  const persisted = await db.dailyReport.findUnique({ where: { date: new Date(date) } });
  const rows = (persisted?.details as { step5BigTech?: { value: string }[] } | null)?.step5BigTech;
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
  try {
    sectors = await fetchAllSectors();
  } catch {
    // 섹터 조회 실패해도 나머지 분석은 계속 — 6단계만 빈 값으로
  }

  const today = new Date().toISOString().slice(0, 10);
  const [manualInputs, bigTechReasons] = await Promise.all([
    getManualInputsForDate(today),
    getPersistedBigTechReasons(today),
  ]);

  return runDailyAnalysis({
    domesticWeightHigh: manualInputs.domesticWeightHigh,
    fearGreed: manualInputs.fearGreed,
    sectors: sectors.map((s) => ({ name: s.name, return5d: s.return5d, volumeRatio: s.volumeRatio })),
    bigTechReasons,
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
