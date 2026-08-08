// 전체 리포트 재작성 — 외부 감사 1(반올림)·4(뉴스 백분위) 반영, pptSlides/comprehensiveReport 재생성.
// step2~8 top-level JSON은 안 건드림(drift 회피).
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { getNewsRiskScorePercentile } from "../src/lib/news-events";
import { buildPptSlides } from "../src/lib/scoring/ppt-slides";
import { generatePptHeadlines } from "../src/lib/ppt-headlines";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";
import type {
  StepDetails, StepDetailRow, Step1Result, Step2Result, Step3Result, Step4Result, Step5Result, Step6Result, Step7Result, Step8Result,
} from "../src/lib/scoring/types";

function leadingNumber(v: string): number | null { const m = v.match(/^(-?\d+\.?\d*)/); return m ? parseFloat(m[1]) : null; }
function trailingPercent(v: string): number | null {
  const m = [...v.matchAll(/([+-]?\d+\.\d+)%/g)];
  return m.length ? parseFloat(m[m.length - 1][1]) : null;
}
function fiveDayReturn(v: string): number | null { const m = v.match(/5일\s*(-?\d+\.?\d*)%/); return m ? parseFloat(m[1]) : null; }

async function main() {
  const rows = await db.dailyReport.findMany({ orderBy: { date: "asc" } });
  console.log(`${rows.length}건 재작성 시작`);

  for (const row of rows) {
    const dateStr = row.date.toISOString().slice(0, 10);
    const step1 = row.step1 as unknown as Step1Result & { newsRiskScore?: number };
    const step2 = row.step2 as unknown as Step2Result;
    const step3 = row.step3 as unknown as Step3Result;
    const step4 = row.step4 as unknown as Step4Result;
    const step5 = row.step5 as unknown as Step5Result;
    const step6 = row.step6 as unknown as Step6Result;
    const step7 = row.step7 as unknown as Step7Result;
    const step8 = row.step8 as unknown as Step8Result;
    const details = (row.details ?? {}) as unknown as StepDetails;

    const oldStep2Summary = details.step2Summary ?? "";
    const step2Lines = oldStep2Summary.split("\n");
    if (step2Lines[0]) step2Lines[0] = step2Lines[0].replace(/점수 [\d.]+\/10/, `점수 ${step2.finalScore.toFixed(2)}/10`);
    const newStep2Summary = step2Lines.join("\n");

    const newStep8Details: StepDetailRow[] = (details.step8 ?? []).map((r) =>
      r.label === "투자 적합도 점수" ? { ...r, value: step8.macroTrendScore.toFixed(2) } : r
    );

    const newsRiskScore = step1.newsRiskScore ?? leadingNumber((details.step1 ?? []).find((r) => r.label === "최근 7일 리스크 뉴스 가중점수")?.value ?? "");
    const percentile = newsRiskScore !== null ? await getNewsRiskScorePercentile(newsRiskScore, row.createdAt) : null;
    const baseRows = (details.step1 ?? []).filter((r) => r.label !== "최근 기록 대비 참고 맥락");
    const idx = baseRows.findIndex((r) => r.label === "최근 7일 리스크 뉴스 가중점수");
    const percentileRow: StepDetailRow | null = percentile
      ? { label: "최근 기록 대비 참고 맥락", criterion: "판정에 관여하지 않는 정보성 지표", value: `최근 ${percentile.sampleSize}일 중 상위 ${100 - percentile.percentile}% 수준`, met: null }
      : null;
    const newStep1Details = percentileRow && idx !== -1
      ? [...baseRows.slice(0, idx + 1), percentileRow, ...baseRows.slice(idx + 1)]
      : baseRows;

    const mixedDetails: StepDetails = { ...details, step1: newStep1Details, step2Summary: newStep2Summary, step8: newStep8Details };

    const vixRow = details.step7?.find((r) => r.label === "VIX");
    const fgRow = details.step7?.find((r) => r.label === "CNN 공포와 탐욕지수");
    const vix = vixRow && vixRow.value !== "확인 못함" ? leadingNumber(vixRow.value) : null;
    const fearGreed = fgRow && fgRow.value !== "확인 못함" ? leadingNumber(fgRow.value) : null;
    const bigTechMovers = (details.step5BigTech ?? []).map((r) => {
      const m = r.label.match(/^(.+)\(([A-Z.]+)\)$/);
      return { ticker: m ? m[2] : r.label, label: m ? m[1] : r.label, changePct: trailingPercent(r.value), reason: "" };
    });
    const sectors = (details.step6 ?? [])
      .map((r) => ({ name: r.label, return5d: fiveDayReturn(r.value) }))
      .filter((s): s is { name: string; return5d: number } => s.return5d !== null)
      .map((s) => ({ ...s, volumeRatio: 0 }));

    const pptBase = buildPptSlides({
      step1, step2, step3, step4, step5, step6, step7, step8,
      step2Summary: newStep2Summary,
      step3Summary: details.step3Summary ?? "",
      step4Summary: details.step4Summary ?? "",
      step5Summary: details.step5Summary ?? "",
      step6Summary: details.step6Summary ?? "",
      step7Summary: details.step7Summary ?? "",
      vix, fearGreed, sectors, bigTechMovers,
    });

    let slides = pptBase;
    try {
      const headlines = await generatePptHeadlines(pptBase);
      slides = pptBase.map((s) => ({ ...s, headline: headlines[s.step] ?? s.kicker }));
    } catch (err) {
      console.error(dateStr, "헤드라인 실패:", err instanceof Error ? err.message : String(err));
    }
    mixedDetails.pptSlides = slides;

    try {
      const reportForNarrative = { step1, step2, step3, step4, step5, step6, step7, step8, details: mixedDetails };
      mixedDetails.comprehensiveReport = await generateComprehensiveReport(reportForNarrative);
    } catch (err) {
      console.error(dateStr, "종합보고서 실패, 기존 유지:", err instanceof Error ? err.message : String(err));
    }

    const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
    await db.dailyReport.update({ where: { date: row.date }, data: { details: asJson(mixedDetails) } });
    console.log(`${dateStr} 완료 — 백분위: ${percentileRow?.value ?? "N/A"}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log("전체 완료");
}
main().then(() => db.$disconnect());
