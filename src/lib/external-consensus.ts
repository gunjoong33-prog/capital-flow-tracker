// 4개 외부 소스(13F·BIS·Finnhub·국내 컨센서스)를 모아 ExternalConsensus에 저장하는 오케스트레이션.
// 소스 모듈은 전부 던지지 않고 errors를 반환하므로, 이 계층에서 모든 errors를 하나로 합쳐 호출부에
// 넘긴다(institutional-signals.ts가 이미 하는 패턴과 동일).
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { TRACKED_HEDGE_FUNDS, fetchHedgeFundHoldings } from "@/lib/sources/sec-13f";
import { fetchPolicyRates } from "@/lib/sources/bis";
import { fetchRecommendationTrend } from "@/lib/sources/finnhub";
import { fetchBrokerConsensus } from "@/lib/sources/broker-consensus";

// Prisma의 Json 컬럼은 우리 소스 모듈들의 구체 타입을 그대로 받아주지 않으므로(인덱스 시그니처 요구),
// pipeline.ts·period-report.ts와 같은 방식으로 캐스팅한다.
const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;

// fetchBrokerConsensus(네이버금융)는 6자리 KRX 종목코드를 기대하는데, 예전엔 US 티커
// (TRACKED_TICKERS: AAPL 등)를 그대로 넘겨서 매주 전량 실패했다(최종 리뷰 지적). 국내
// 소스 모듈(krx-short.ts·types.ts 등)에 기존 KRX 종목코드 상수가 없어서, 시총 상위
// 4종목(삼성전자·SK하이닉스·NAVER·카카오)을 새로 하드코딩한다.
export const TRACKED_KRX_TICKERS = ["005930", "000660", "035420", "035720"];

export async function collectExternalConsensus(
  tickers: string[],
  krxTickers: string[] = TRACKED_KRX_TICKERS
): Promise<{ saved: number; errors: string[] }> {
  const errors: string[] = [];
  let saved = 0;
  const today = new Date();

  for (const fund of TRACKED_HEDGE_FUNDS) {
    const { holdings, filingDate, errors: fundErrors } = await fetchHedgeFundHoldings(fund.cik);
    errors.push(...fundErrors);
    if (holdings.length > 0) {
      const date = filingDate ? new Date(filingDate) : today;
      // 같은 13F 제출(filingDate 불변)을 매주 다시 조회해도 create면 근중복 행이 계속 쌓인다
      // (최종 리뷰 지적) — sourceType+sourceName+date 유니크 제약 기준으로 upsert한다.
      await db.externalConsensus.upsert({
        where: { sourceType_sourceName_date: { sourceType: "13f", sourceName: fund.name, date } },
        create: { sourceType: "13f", sourceName: fund.name, date, payload: asJson(holdings) },
        update: { payload: asJson(holdings) },
      });
      saved++;
    }
  }

  const { rates, errors: bisErrors } = await fetchPolicyRates();
  errors.push(...bisErrors);
  if (rates.length > 0) {
    await db.externalConsensus.upsert({
      where: { sourceType_sourceName_date: { sourceType: "bis", sourceName: "BIS", date: today } },
      create: { sourceType: "bis", sourceName: "BIS", date: today, payload: asJson(rates) },
      update: { payload: asJson(rates) },
    });
    saved++;
  }

  for (const ticker of tickers) {
    const { trend, errors: finnhubErrors } = await fetchRecommendationTrend(ticker);
    errors.push(...finnhubErrors);
    if (trend) {
      await db.externalConsensus.upsert({
        where: { sourceType_sourceName_date: { sourceType: "finnhub", sourceName: ticker, date: today } },
        create: { sourceType: "finnhub", sourceName: ticker, date: today, payload: asJson(trend) },
        update: { payload: asJson(trend) },
      });
      saved++;
    }
  }

  // fetchBrokerConsensus(네이버금융)는 US 티커가 아니라 6자리 KRX 종목코드를 받는다 — tickers와
  // 별도 리스트로 분리해서 넘긴다(위 TRACKED_KRX_TICKERS 주석 참고).
  for (const krxTicker of krxTickers) {
    const { consensus, errors: brokerErrors } = await fetchBrokerConsensus(krxTicker);
    errors.push(...brokerErrors);
    if (consensus) {
      await db.externalConsensus.upsert({
        where: { sourceType_sourceName_date: { sourceType: "domestic_broker", sourceName: krxTicker, date: today } },
        create: { sourceType: "domestic_broker", sourceName: krxTicker, date: today, payload: asJson(consensus) },
        update: { payload: asJson(consensus) },
      });
      saved++;
    }
  }

  return { saved, errors };
}
