// 7/27~7/31 리포트 5건에 신규 지표 4종(FINRA·Put/Call·KRX·DART)을 백필한다.
// backfill-institutional-edge-marketdate-fix.ts와 동일 원칙(report.marketDate 앵커,
// runDailyAnalysis 재계산 없음) — 대상 날짜만 다르다. 7월은 date===marketDate로 확인됨
// (8월과 달리 어긋남 없음 — 그래도 marketDate 필드를 그대로 쓴다, 가정하지 않는다).
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

const DATES = ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"];

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

  console.log("\n전체 백필 완료");
}

main()
  .then(() => db.$disconnect())
  .catch((err) => {
    console.error(err);
    return db.$disconnect();
  });
