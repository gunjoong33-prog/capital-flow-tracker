import { runDailyAnalysis } from "@/lib/scoring/run";
import { fetchAllSectors } from "@/lib/sources/yahoo";
import { getManualInputsForDate } from "@/lib/manual-inputs";
import { db } from "@/lib/db";
import { BIG_TECH_TICKERS } from "@/lib/sources/types";
import { ReportView } from "@/components/ReportView";
import { SiteNav } from "@/components/SiteNav";

export const dynamic = "force-dynamic"; // 매번 최신 DB 값으로 계산 — 캐시하면 안 됨

// 홈은 매번 새로 계산하지만, Gemini(빅테크 원인)·외부 스크래핑(기관·내부자 매집)까지
// 접속마다 반복하면 무료 티어 소진·응답 지연이 생기므로 하루 1회(파이프라인)만 돌린 결과를
// 오늘자 DB에서 읽어 재사용한다. 나머지(가격·점수 등)는 live 값을 그대로 쓴다.
const INSTITUTIONAL_ROW_LABELS = new Set([
  "슈퍼 투자자 포트폴리오",
  "종목별 기관 지분 분석",
  "섹터 및 자금 흐름",
  "내부자 거래",
  "전단계 섹터·종목과 일치 여부",
]);

interface PersistedDetails {
  step5BigTech?: { value: string }[];
  step7?: { label: string; criterion: string; value: string; met: boolean | null }[];
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
  try {
    sectors = await fetchAllSectors();
  } catch {
    // 섹터 조회 실패해도 나머지 분석은 계속 — 6단계만 빈 값으로
  }

  const today = new Date().toISOString().slice(0, 10);
  const [manualInputs, persistedDetails] = await Promise.all([
    getManualInputsForDate(today),
    getPersistedDetails(today),
  ]);

  const report = await runDailyAnalysis({
    domesticWeightHigh: manualInputs.domesticWeightHigh,
    fearGreed: manualInputs.fearGreed,
    sectors: sectors.map((s) => ({ name: s.name, return5d: s.return5d, volumeRatio: s.volumeRatio })),
    bigTechReasons: extractBigTechReasons(persistedDetails),
  });

  // 기관·내부자 매집 5개 행은 오늘자 파이프라인이 이미 계산해둔 걸 그대로 갖다 붙인다
  // (institutional-signals.ts는 live 경로에서 호출 안 해서 여기선 항상 "확인 못함" 자리표시자뿐임).
  const persistedStep7 = persistedDetails?.step7;
  if (persistedStep7) {
    report.details.step7 = report.details.step7.map((row) => {
      if (!INSTITUTIONAL_ROW_LABELS.has(row.label)) return row;
      return persistedStep7.find((p) => p.label === row.label) ?? row;
    });
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
