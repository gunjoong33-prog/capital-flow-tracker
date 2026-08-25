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

export async function collectExternalConsensus(tickers: string[]): Promise<{ saved: number; errors: string[] }> {
  const errors: string[] = [];
  let saved = 0;
  const today = new Date();

  for (const fund of TRACKED_HEDGE_FUNDS) {
    const { holdings, filingDate, errors: fundErrors } = await fetchHedgeFundHoldings(fund.cik);
    errors.push(...fundErrors);
    if (holdings.length > 0) {
      await db.externalConsensus.create({
        data: { sourceType: "13f", sourceName: fund.name, date: filingDate ? new Date(filingDate) : today, payload: asJson(holdings) },
      });
      saved++;
    }
  }

  const { rates, errors: bisErrors } = await fetchPolicyRates();
  errors.push(...bisErrors);
  if (rates.length > 0) {
    await db.externalConsensus.create({ data: { sourceType: "bis", sourceName: "BIS", date: today, payload: asJson(rates) } });
    saved++;
  }

  for (const ticker of tickers) {
    const { trend, errors: finnhubErrors } = await fetchRecommendationTrend(ticker);
    errors.push(...finnhubErrors);
    if (trend) {
      await db.externalConsensus.create({ data: { sourceType: "finnhub", sourceName: ticker, date: today, payload: asJson(trend) } });
      saved++;
    }

    const { consensus, errors: brokerErrors } = await fetchBrokerConsensus(ticker);
    errors.push(...brokerErrors);
    if (consensus) {
      await db.externalConsensus.create({ data: { sourceType: "domestic_broker", sourceName: ticker, date: today, payload: asJson(consensus) } });
      saved++;
    }
  }

  return { saved, errors };
}
