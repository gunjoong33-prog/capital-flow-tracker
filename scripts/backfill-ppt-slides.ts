// 기존 DailyReport 전부(11건, 2026-07-27~2026-08-08 기준)에 pptSlides를 채워 넣는 1회성 백필.
// runDailyAnalysis()를 다시 돌리지 않는다 — asOf 없이 재계산하면 시계열이 나중에 갱신되면서
// step2~4 drift가 생긴다는 걸 이미 이번 세션에서 실측했다([[capital_flow_tracker_narrative_audit_2026_08]]).
// 대신 이미 저장된 details.step5BigTech/step6/step7 표시 문자열에서 필요한 숫자만 안전하게
// 파싱해 buildPptSlides() 입력을 재구성한다 — 원본 step1~8/comprehensiveReport는 전혀 안 건드리고
// details.pptSlides 필드만 patch한다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { buildPptSlides } from "../src/lib/scoring/ppt-slides";
import { generatePptHeadlines } from "../src/lib/ppt-headlines";
import type {
  StepDetails, Step1Result, Step2Result, Step3Result, Step4Result, Step5Result, Step6Result, Step7Result, Step8Result,
} from "../src/lib/scoring/types";

function leadingNumber(value: string): number | null {
  const m = value.match(/^(-?\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
}
function trailingPercent(value: string): number | null {
  const matches = [...value.matchAll(/([+-]?\d+\.\d+)%/g)];
  if (matches.length === 0) return null;
  return parseFloat(matches[matches.length - 1][1]);
}
function fiveDayReturn(value: string): number | null {
  const m = value.match(/5일\s*(-?\d+\.?\d*)%/);
  return m ? parseFloat(m[1]) : null;
}

async function main() {
  const rows = await db.dailyReport.findMany({ orderBy: { date: "asc" } });
  console.log(`${rows.length}건 백필 시작`);

  for (const row of rows) {
    const step1 = row.step1 as unknown as Step1Result;
    const step2 = row.step2 as unknown as Step2Result;
    const step3 = row.step3 as unknown as Step3Result;
    const step4 = row.step4 as unknown as Step4Result;
    const step5 = row.step5 as unknown as Step5Result;
    const step6 = row.step6 as unknown as Step6Result;
    const step7 = row.step7 as unknown as Step7Result;
    const step8 = row.step8 as unknown as Step8Result;
    const details = (row.details ?? {}) as unknown as StepDetails;
    const dateStr = row.date.toISOString().slice(0, 10);

    const vixRow = details.step7?.find((r) => r.label === "VIX");
    const fgRow = details.step7?.find((r) => r.label === "CNN 공포와 탐욕지수");
    const vix = vixRow && vixRow.value !== "확인 못함" ? leadingNumber(vixRow.value) : null;
    const fearGreed = fgRow && fgRow.value !== "확인 못함" ? leadingNumber(fgRow.value) : null;

    const bigTechMovers = (details.step5BigTech ?? [])
      .map((r) => {
        const m = r.label.match(/^(.+)\(([A-Z.]+)\)$/);
        return {
          ticker: m ? m[2] : r.label,
          label: m ? m[1] : r.label,
          changePct: trailingPercent(r.value),
          reason: "",
        };
      });

    const sectors = (details.step6 ?? [])
      .map((r) => ({ name: r.label, return5d: fiveDayReturn(r.value) }))
      .filter((s): s is { name: string; return5d: number } => s.return5d !== null)
      .map((s) => ({ ...s, volumeRatio: 0 }));

    const slidesBase = buildPptSlides({
      step1, step2, step3, step4, step5, step6, step7, step8,
      step2Summary: details.step2Summary ?? "",
      step3Summary: details.step3Summary ?? "",
      step4Summary: details.step4Summary ?? "",
      step5Summary: details.step5Summary ?? "",
      step6Summary: details.step6Summary ?? "",
      step7Summary: details.step7Summary ?? "",
      vix,
      fearGreed,
      sectors,
      bigTechMovers,
    });

    let slides = slidesBase;
    try {
      const headlines = await generatePptHeadlines(slidesBase);
      slides = slidesBase.map((s) => ({ ...s, headline: headlines[s.step] ?? s.kicker }));
    } catch (err) {
      console.error(dateStr, "헤드라인 생성 실패, kicker로 폴백:", err instanceof Error ? err.message : String(err));
    }

    const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
    await db.dailyReport.update({
      where: { date: row.date },
      data: { details: asJson({ ...details, pptSlides: slides }) },
    });
    console.log(`${dateStr} 완료 — vix=${vix} fearGreed=${fearGreed} bigTechMovers=${bigTechMovers.length} sectors=${sectors.length}`);

    // Groq 무료 티어 레이트리밋을 피하려고 호출 사이에 짧게 쉰다.
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("백필 완료");
}

main().then(() => db.$disconnect());
