// 2026-08-04~08 리포트 5건에 신규 지표 4종(FINRA 공매도거래비중·Put/Call 비율·KRX 공매도잔고비중·
// DART 지분공시)을 백필한다 — 이번 한 번만 예외(사용자 명시적 요청). 다른 백필 스크립트와 같은
// 원칙: runDailyAnalysis()를 다시 안 돌린다(asOf 재계산은 시계열 drift로 불안전함이 실측 확인됨,
// [[capital_flow_tracker_narrative_audit_2026_08]]). 대신 각 날짜별로 실제 과거 데이터를 직접
// 조회해서 details.step7Institutional·details.step7에 새 행만 추가/치환한다. step1~8 점수와
// comprehensiveReport는 전혀 안 건드린다(새 지표 전부 met:null 참고 정보라 점수에 관여 안 함).
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
    console.log(`\n=== ${dateStr} ===`);
    const refDate = new Date(`${dateStr}T12:00:00Z`); // 정오 고정 — UTC 날짜 밀림 방지(기존 백필 스크립트와 동일 관례)

    const [finraResult, dartResult, putCallRatio, krxSummary] = await Promise.all([
      fetchShortVolumeRatios(BIG_TECH_TICKERS, refDate, 1),
      fetchEquityDisclosures(dartKey, refDate, 12),
      fetchHistoricalPutCallRatio(avKey, dateStr).catch((err) => {
        console.error("  Put/Call 실패:", err.message);
        return null;
      }),
      fetchKrxShortBalanceSummary(krxId, krxPw, refDate, 1).catch((err) => {
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

    const row = await db.dailyReport.findUnique({ where: { date: new Date(dateStr) } });
    if (!row) {
      console.log("  리포트 없음, 건너뜀");
      continue;
    }
    const details = (row.details ?? {}) as unknown as StepDetails;

    // step7Institutional: 기존 행 유지, 새 라벨 3개(FINRA·KRX·DART)만 없으면 추가/있으면 치환.
    // run.ts와 정확히 같은 라벨·criterion 문자열을 써야 이후 실시간 생성 리포트와 표시가 일치한다.
    const newRows = [
      { label: "빅테크 공매도 거래비중(FINRA)", criterion: "거래대금 중 공매도 비율, T+1 지연 — 대형주는 마켓메이커 유동성공급 때문에 40~50%대가 정상 범위(방향성 약세 신호 아님)", value: shortVolumeSummary, met: null },
      {
        label: "KOSPI 공매도 잔고비중(KRX)",
        criterion: "시가총액가중 평균, T+2 지연",
        value: krxSummary ? `${krxSummary.marketWeightedRatio.toFixed(2)}%(${krxSummary.date} 기준)` : "확인 못함",
        met: null,
      },
      { label: "국내 지분공시(DART)", criterion: "대량보유·임원소유 변동, 당일", value: domesticFilingSummary, met: null },
    ];
    const existingInstitutional = details.step7Institutional ?? [];
    const mergedInstitutional = [...existingInstitutional];
    for (const newRow of newRows) {
      const idx = mergedInstitutional.findIndex((r) => r.label === newRow.label);
      if (idx === -1) mergedInstitutional.push(newRow);
      else mergedInstitutional[idx] = newRow;
    }

    // step7: Put/Call 비율 행 추가/치환.
    const putCallRow = {
      label: "Put/Call 비율(SPY)",
      criterion: "1.0 위=풋 우위(공포), 아래=콜 우위(탐욕) — 참고용, 임계값 미검증이라 미채점",
      value: putCallRatio != null ? putCallRatio.toFixed(2) : "확인 못함",
      met: null,
    };
    const existingStep7 = details.step7 ?? [];
    const mergedStep7 = [...existingStep7];
    const pcIdx = mergedStep7.findIndex((r) => r.label === "Put/Call 비율(SPY)");
    if (pcIdx === -1) mergedStep7.push(putCallRow);
    else mergedStep7[pcIdx] = putCallRow;

    const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
    await db.dailyReport.update({
      where: { date: new Date(dateStr) },
      data: { details: asJson({ ...details, step7Institutional: mergedInstitutional, step7: mergedStep7 }) },
    });
    console.log(`  ${dateStr} 저장 완료`);

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
