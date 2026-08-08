// scripts/backfill-institutional-edge-0804-0808.ts가 report.date를 앵커로 썼던 게 버그였다
// (report.marketDate가 실제로 그 리포트가 다루는 거래일인데, date는 항상 그보다 하루 늦다).
// 같은 5건을 report.marketDate 기준으로 재조회해서 덮어쓴다. 이번에도 runDailyAnalysis는
// 재계산하지 않는다 — step1~8 점수는 그대로, details의 새 행 값만 marketDate 기준으로 고친다.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { fetchShortVolumeRatios } from "../src/lib/sources/finra";
import { fetchEquityDisclosures } from "../src/lib/sources/dart";
import { fetchKrxShortBalanceSummary } from "../src/lib/sources/krx-short";
import { fetchHistoricalPutCallRatio } from "../src/lib/sources/alphavantage";
import { summarizeShortVolume, summarizeDomesticFilings } from "../src/lib/institutional-signals";
import { BIG_TECH_TICKERS } from "../src/lib/sources/types";
import type { StepDetails } from "../src/lib/scoring/types";

const DATES = ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"];

async function main() {
  const avKey = process.env.ALPHA_VANTAGE_API_KEY!;
  const dartKey = process.env.DART_API_KEY!;
  const krxId = process.env.KRX_ID!;
  const krxPw = process.env.KRX_PW!;

  for (const dateStr of DATES) {
    const row = await db.dailyReport.findUnique({ where: { date: new Date(dateStr) } });
    if (!row || !row.marketDate) {
      console.log(`${dateStr}: 리포트 또는 marketDate 없음, 건너뜀`);
      continue;
    }
    const marketDateStr = row.marketDate.toISOString().slice(0, 10);
    console.log(`\n=== ${dateStr} (marketDate=${marketDateStr}) ===`);
    const refDate = new Date(`${marketDateStr}T12:00:00Z`);

    const [finraResult, dartResult, putCallRatio, krxSummary] = await Promise.all([
      fetchShortVolumeRatios(BIG_TECH_TICKERS, refDate, 5),
      fetchEquityDisclosures(dartKey, refDate, 12),
      fetchHistoricalPutCallRatio(avKey, marketDateStr).catch((err) => {
        console.error("  Put/Call 실패:", err.message);
        return null;
      }),
      fetchKrxShortBalanceSummary(krxId, krxPw, refDate, 10).catch((err) => {
        console.error("  KRX 실패:", err.message);
        return null;
      }),
    ]);

    const shortVolumeSummary = summarizeShortVolume(finraResult.rows, finraResult.fileDate);
    const domesticFilingSummary = summarizeDomesticFilings(dartResult.filings);
    console.log("  FINRA:", finraResult.fileDate, finraResult.rows.size, "종목");
    console.log("  DART:", dartResult.filings.length, "건 상세조회");
    console.log("  Put/Call:", putCallRatio);
    console.log("  KRX:", krxSummary?.date, krxSummary?.marketWeightedRatio);

    const details = (row.details ?? {}) as unknown as StepDetails;

    const krxValue = krxSummary
      ? krxSummary.date === marketDateStr
        ? `${krxSummary.marketWeightedRatio.toFixed(2)}%(${krxSummary.date} 기준)`
        : `${krxSummary.marketWeightedRatio.toFixed(2)}%(${krxSummary.date} 기준, ${marketDateStr} 시점 최신 가용치)`
      : "확인 못함";

    const newRows = [
      { label: "빅테크 공매도 거래비중(FINRA)", criterion: "거래대금 중 공매도 비율, T+1 지연 — 대형주는 마켓메이커 유동성공급 때문에 40~50%대가 정상 범위(방향성 약세 신호 아님)", value: shortVolumeSummary, met: null },
      { label: "KOSPI 공매도 잔고비중(KRX)", criterion: "시가총액가중 평균, T+2 지연", value: krxValue, met: null },
      { label: "국내 지분공시(DART)", criterion: "대량보유·임원소유 변동, 당일", value: domesticFilingSummary, met: null },
    ];
    const mergedInstitutional = [...(details.step7Institutional ?? [])];
    for (const newRow of newRows) {
      const idx = mergedInstitutional.findIndex((r) => r.label === newRow.label);
      if (idx === -1) mergedInstitutional.push(newRow);
      else mergedInstitutional[idx] = newRow;
    }

    const putCallRow = {
      label: "Put/Call 비율(SPY)",
      criterion: "1.0 위=풋 우위(공포), 아래=콜 우위(탐욕) — 참고용, 임계값 미검증이라 미채점",
      value: putCallRatio != null ? putCallRatio.toFixed(2) : "확인 못함",
      met: null,
    };
    const mergedStep7 = [...(details.step7 ?? [])];
    const pcIdx = mergedStep7.findIndex((r) => r.label === "Put/Call 비율(SPY)");
    if (pcIdx === -1) mergedStep7.push(putCallRow);
    else mergedStep7[pcIdx] = putCallRow;

    const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
    await db.dailyReport.update({
      where: { date: new Date(dateStr) },
      data: { details: asJson({ ...details, step7Institutional: mergedInstitutional, step7: mergedStep7 }) },
    });
    console.log(`  ${dateStr} 저장 완료(marketDate=${marketDateStr} 기준)`);

    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log("\n전체 재백필 완료");
}

main()
  .then(() => db.$disconnect())
  .catch((err) => {
    console.error(err);
    return db.$disconnect();
  });
