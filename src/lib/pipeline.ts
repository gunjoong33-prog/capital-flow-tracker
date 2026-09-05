import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { kstToday } from "@/lib/date";
import { Prisma } from "@/generated/prisma/client";
import { saveMetricPoints } from "@/lib/metrics";
import { fetchAllFredMetrics, fetchLatestFredMetrics, MONTHLY_FRED_METRICS } from "@/lib/sources/fred";
import { fetchCftcJpyNetPositionLatest } from "@/lib/sources/cftc";
import { fetchCoinGeckoLatest } from "@/lib/sources/coingecko";
import { fetchJp10yLatest } from "@/lib/sources/mof-japan";
import { fetchAllYahooLatest, fetchAllSectors } from "@/lib/sources/yahoo";
import { fetchKr10y } from "@/lib/sources/ecos";
import { fetchCnnFearGreedLatest } from "@/lib/sources/cnn-feargreed";
import { fetchForeignNetBuyKospi } from "@/lib/sources/korea-investment";
import { runDailyAnalysis } from "@/lib/scoring/run";
import { generateNarrative, buildDailyNarrativePrompt } from "@/lib/narrative";
import { generateComprehensiveReport } from "@/lib/comprehensive-report";
import { generatePptHeadlines } from "@/lib/ppt-headlines";
import { writeDailyChecklistToNotion, writeCalendarEntry, type DailyNotionInput } from "@/lib/notion-write";
import { generatePeriodReportsIfDue } from "@/lib/period-report";
import { exportDailyReportNow } from "@/lib/obsidian-export";
import { sendReportUploadedAlert } from "@/lib/discord-alert";
import { syncMajorEvents } from "@/lib/major-events";
import { syncNewsEvents } from "@/lib/news-events";
import { syncNewsPageHeadlines, saveMarketEventHeadlines } from "@/lib/news-page";
import { buildEventOutcomeHeadlines, buildInstitutionalHeadlines } from "@/lib/news-market-events";
import { computeBigTechReasons } from "@/lib/bigtech-reasons";
import { computeInstitutionalSignals } from "@/lib/institutional-signals";
import { BIG_TECH_TICKERS, METRICS, SECTOR_ETFS, type FetchedPoint } from "@/lib/sources/types";
import { getLatestMetric } from "@/lib/metrics";
import { fetchIndexFallback, fetchSectorFallback, fetchHistoricalPutCallRatio, alphaVantagePace } from "@/lib/sources/alphavantage";
import { fetchKrxShortBalanceSummary } from "@/lib/sources/krx-short";

export interface DailyPipelineResult {
  date: string;
  metricsSaved: number;
  sourceErrors: { source: string; error: string }[];
  narrative: string;
  finalDecision: string;
  macroTrendScore: number;
  notionWriteCount: number;
  periodReportsGenerated: string[];
}

// Promise.allSettled 결과 처리부(아래) 10곳 전부가 실패(rejected) 분기에서 이 한 줄을 반복했다
// (코드 감사로 발견) — "fulfilled"일 때 points/errors를 꺼내는 모양은 소스마다 달라 공용화하지
// 않고, 정확히 같은 모양인 rejected 분기만 뽑는다.
function recordSourceError(sourceErrors: { source: string; error: string }[], source: string, reason: unknown) {
  sourceErrors.push({ source, error: String(reason) });
}

/**
 * 매일 아침 9시(KST) 실행되는 전체 파이프라인.
 * 1) 데이터 수집 2) 채점 3) 해설 생성 4) DB 저장 5) 노션 기록
 *
 * 뉴스 판단·엔화 변동성 급등·심리지수(CNN F&G)는 자동 소스가 없어 아직 기본값(placeholder)이다 —
 * 지난 감사에서 정한 원칙대로, 없는 데이터는 지어내지 않고 "미확인"으로 남겨둔다.
 */
export async function runDailyPipeline(): Promise<DailyPipelineResult> {
  const today = kstToday();
  const sourceErrors: { source: string; error: string }[] = [];
  const allPoints: FetchedPoint[] = [];

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  // 1) 데이터 수집 — 서로 독립적인 소스라 병렬로 실행 (뉴스 판정·주요 이벤트 동기화도 여기 포함)
  const [
    fredResult, fredMonthlyResult, cftcResult, coingeckoResult, jp10yResult, yahooResult, sectorsResult,
    kr10yResult, fearGreedResult, majorEventsResult, newsEventsResult, newsPageResult, foreignNetBuyResult,
  ] = await Promise.allSettled([
      process.env.FRED_API_KEY
        ? fetchAllFredMetrics(process.env.FRED_API_KEY, sevenDaysAgoStr)
        : Promise.resolve({ points: [], errors: [{ metric: "FRED", message: "FRED_API_KEY 없음" }] }),
      // 위 fetchAllFredMetrics의 "최근 7일" 창은 월간 지표(CPI 등 7개)의 신규 관측치(항상 발표월
      // 1일자)를 거의 항상 놓친다 — MONTHLY_FRED_METRICS 주석 참고. 이 7개만 날짜창 없이 별도 수집.
      process.env.FRED_API_KEY
        ? fetchLatestFredMetrics(MONTHLY_FRED_METRICS, process.env.FRED_API_KEY)
        : Promise.resolve({ points: [], errors: [{ metric: "FRED(월간)", message: "FRED_API_KEY 없음" }] }),
      fetchCftcJpyNetPositionLatest(),
      fetchCoinGeckoLatest(),
      fetchJp10yLatest(),
      fetchAllYahooLatest(),
      fetchAllSectors(),
      process.env.ECOS_API_KEY ? fetchKr10y(process.env.ECOS_API_KEY, sevenDaysAgo) : Promise.resolve([]),
      fetchCnnFearGreedLatest(),
      syncMajorEvents(),
      syncNewsEvents(),
      syncNewsPageHeadlines(),
      fetchForeignNetBuyKospi(),
    ]);

  if (majorEventsResult.status === "fulfilled") {
    for (const e of majorEventsResult.value.errors) sourceErrors.push({ source: "주요이벤트일정", error: e });
  } else recordSourceError(sourceErrors, "주요이벤트일정", majorEventsResult.reason);

  if (newsEventsResult.status === "fulfilled") {
    for (const e of newsEventsResult.value.errors) sourceErrors.push({ source: "뉴스판정", error: e });
  } else recordSourceError(sourceErrors, "뉴스판정", newsEventsResult.reason);

  if (newsPageResult.status === "fulfilled") {
    for (const e of newsPageResult.value.errors) sourceErrors.push({ source: "뉴스페이지", error: e });
  } else recordSourceError(sourceErrors, "뉴스페이지", newsPageResult.reason);

  if (foreignNetBuyResult.status === "fulfilled") {
    allPoints.push(...foreignNetBuyResult.value.points);
    for (const e of foreignNetBuyResult.value.errors) sourceErrors.push({ source: "외국인 순매수(코스피, KIS)", error: e });
  } else recordSourceError(sourceErrors, "외국인 순매수(코스피, KIS)", foreignNetBuyResult.reason);

  if (fredResult.status === "fulfilled") {
    allPoints.push(...fredResult.value.points);
    for (const e of fredResult.value.errors) sourceErrors.push({ source: `FRED:${e.metric}`, error: e.message });
  } else recordSourceError(sourceErrors, "FRED", fredResult.reason);

  if (fredMonthlyResult.status === "fulfilled") {
    allPoints.push(...fredMonthlyResult.value.points);
    for (const e of fredMonthlyResult.value.errors) sourceErrors.push({ source: `FRED(월간):${e.metric}`, error: e.message });
  } else recordSourceError(sourceErrors, "FRED(월간)", fredMonthlyResult.reason);

  if (cftcResult.status === "fulfilled" && cftcResult.value) allPoints.push(cftcResult.value);
  else if (cftcResult.status === "rejected") recordSourceError(sourceErrors, "CFTC", cftcResult.reason);

  if (coingeckoResult.status === "fulfilled") allPoints.push(...coingeckoResult.value);
  else recordSourceError(sourceErrors, "CoinGecko", coingeckoResult.reason);

  if (jp10yResult.status === "fulfilled") allPoints.push(...jp10yResult.value);
  else recordSourceError(sourceErrors, "MOF(JP10Y)", jp10yResult.reason);

  if (yahooResult.status === "fulfilled") {
    allPoints.push(...yahooResult.value.points);
    for (const e of yahooResult.value.errors) sourceErrors.push({ source: `Yahoo:${e.metric}`, error: e.message });
  } else recordSourceError(sourceErrors, "Yahoo", yahooResult.reason);

  if (kr10yResult.status === "fulfilled") allPoints.push(...kr10yResult.value);

  if (fearGreedResult.status === "fulfilled") allPoints.push(...fearGreedResult.value);
  else recordSourceError(sourceErrors, "CNN 공포탐욕지수", fearGreedResult.reason);

  // Yahoo는 무료 비공식 API라 막히면 4·5·6단계가 동시에 전멸한다(외부 감사 지적, 실제 확인) —
  // 채점에 실제로 쓰이는 지수 4개(SPX·DJI·NDX·RUT)만 Alpha Vantage로 폴백한다(무료 25회/일이라
  // 전체 커버는 못 하고, 검증 결과 GOLD·DXY·VIX는 ETF 프록시가 못 미더워 제외 — alphavantage.ts
  // 주석 참고). Yahoo가 이미 실패한 날에만 호출되므로 평소엔 한도를 안 쓴다.
  const avApiKey = process.env.ALPHA_VANTAGE_API_KEY;
  const yahooFailedMetrics = new Set(yahooResult.status === "fulfilled" ? yahooResult.value.errors.map((e) => e.metric) : []);
  if (avApiKey) {
    for (const metric of [METRICS.SPX, METRICS.DJI, METRICS.NDX, METRICS.RUT]) {
      if (!yahooFailedMetrics.has(metric)) continue;
      try {
        const lastReal = await getLatestMetric(metric);
        if (!lastReal) throw new Error("과거 실제값이 없어 등락률을 곱할 기준점이 없다");
        const point = await fetchIndexFallback(metric, lastReal.value, avApiKey, today);
        allPoints.push(point);
      } catch (err) {
        sourceErrors.push({ source: `AlphaVantage(지수 폴백):${metric}`, error: err instanceof Error ? err.message : String(err) });
      }
      await alphaVantagePace();
    }
  }

  // marketDate: 이 리포트가 실제로 반영한 미국장 마감 거래일. today(크론 실행일 KST)와 다를 수 있다 —
  // 크론은 주말·미국 휴장일에도 매일 돌기 때문에(vercel.json "0 0 * * *"), 그런 날은 SPX 등 Yahoo
  // 종가가 직전 거래일 것 그대로 다시 들어온다(외부 감사 지적 — 8/1·8/2가 모두 7/31 데이터로 리포트가
  // 중복 생성되는 문제, 실제 확인). SPX 포인트의 date를 그대로 쓰면 어떤 소스(Yahoo/Alpha Vantage
  // 폴백)든 "그 값이 실제로 어느 거래일 것인가"를 정확히 반영한다.
  //
  // allPoints.find()가 아니라 최댓값(가장 최근 날짜)을 찾아야 한다 — fetchAllYahooLatest()가
  // "5d" range로 지수를 조회해서 SPX가 최근 5거래일치(예: 7/27~7/31) 여러 개로 allPoints에
  // 쌓이는데, Yahoo가 오래된 날짜부터 순서대로 반환해서 find()는 그중 가장 오래된 걸 집는다 —
  // 실제 라이브 파이프라인 실행에서 marketDate가 7/31 대신 7/27로 잘못 계산돼 휴장일 중복 방지
  // 로직 전체가 무력화된 걸 확인했다(사용자가 라이브 테스트로 발견).
  const spxDates = allPoints.filter((p) => p.metric === METRICS.SPX).map((p) => p.date);
  const marketDate = spxDates.length > 0 ? spxDates.reduce((latest, d) => (d > latest ? d : latest)) : today;

  const metricsSaved = await saveMetricPoints(allPoints);

  // 휴장일(주말 등) 중복 실행 방지 — 크론은 요일 상관없이 매일 돈다(vercel.json "0 0 * * *")인데,
  // 미국장이 쉰 날은 Yahoo 종가가 직전 거래일 것 그대로 다시 들어와 marketDate가 안 바뀐다. 이걸
  // 그대로 새 DailyReport로 저장하면 같은 시장 데이터가 여러 date에 중복 계상돼 백테스트가 왜곡된다
  // (외부 감사 지적, 실제 확인 — 8/1·8/2 리포트가 둘 다 7/31 데이터였던 사례). 직전 리포트와
  // marketDate가 같으면 새 리포트를 만들지 않고 여기서 끝낸다 — 원자료(MetricValue)는 위에서 이미
  // 정상 저장했으니 FRED처럼 주말에도 갱신되는 지표는 손실 없다.
  //
  // 이 판정을 가능한 한 일찍(무거운 계산 전에) 해야 한다 — 처음엔 runDailyAnalysis()·섹터
  // Alpha Vantage 폴백·빅테크 등락원인(Groq)·기관매집(Dataroma/OpenInsider 스크레이핑)을 전부
  // 계산한 "뒤에" 이 판정을 해서, 휴장일마다 저장만 스킵하고 이 무거운 API 호출들은 매번 낭비되고
  // 있었다(코드 재검토 중 발견, 실제 확인). marketDate는 위에서 이미 구했으니 그 무거운 계산들
  // 전에 여기서 먼저 판정한다.
  const previousReport = await db.dailyReport.findFirst({
    where: { date: { lt: new Date(today) } },
    orderBy: { date: "desc" },
  });
  const isRepeatMarketDay =
    previousReport?.marketDate != null &&
    previousReport.marketDate.toISOString().slice(0, 10) === marketDate;
  if (isRepeatMarketDay) {
    sourceErrors.push({ source: "휴장일 스킵", error: `marketDate(${marketDate})가 직전 리포트와 동일 — 새 일일 리포트 생성 건너뜀` });
  }

  let narrative = "";
  let notionWriteCount = 0;
  let finalDecision = (previousReport?.step8 as { finalDecision?: string } | null)?.finalDecision ?? "";
  let macroTrendScore = (previousReport?.step8 as { macroTrendScore?: number } | null)?.macroTrendScore ?? 0;

  // 주간 리포트 실시일(period-report.ts isReportDay)은 매주 일요일인데, 일요일은 항상 미국장
  // 휴장일이라 isRepeatMarketDay가 상시 참이 된다 — 이 블록 전체를 건너뛰는 return으로 처리하면
  // 아래 6)번 주기별 리포트 생성까지 같이 막혀서 주간 리포트가 영구히 안 만들어진다(연간도 1/1이
  // 항상 휴장일이라 같은 문제 — 실제 라이브에서 확인된 회귀). 그래서 "새 일일 리포트 계산·저장"만
  // 통째로 건너뛰고, 6)번은 아래에서 항상 실행한다 — 주기별 집계는 이미 저장된 과거 DailyReport만
  // 읽으므로 오늘자 새 리포트 생성 여부와 무관하게 항상 돌아도 안전하다.
  if (!isRepeatMarketDay) {
    // ticker를 계속 들고 다닌다 — 채점 입력(name/return5d/changePct1d/volumeRatio)과 시계열 저장
    // (SECTOR_<티커>_*) 둘 다 Yahoo 성공분·Alpha Vantage 폴백분이 합쳐진 같은 목록을 써야
    // 저장 누락 없이 일치한다.
    const sectors: { name: string; ticker: string; return5d: number; changePct1d: number; volumeRatio: number; source: "yahoo" | "alphavantage" }[] =
      sectorsResult.status === "fulfilled"
        ? sectorsResult.value.sectors.map((s) => ({ ...s, source: "yahoo" as const }))
        : [];
    const missingSectorLabels: string[] = [];
    if (sectorsResult.status !== "fulfilled") recordSourceError(sourceErrors, "섹터(Yahoo)", sectorsResult.reason);

    // 섹터 폴백은 Yahoo와 같은 티커(XLK 등)를 그대로 쓰므로 지수 폴백과 달리 스케일 문제가 없다 —
    // 실패한 섹터만 Alpha Vantage로 직접 계산해서 채운다.
    if (sectorsResult.status === "fulfilled") {
      const tickerToKey = new Map<string, keyof typeof SECTOR_ETFS>(
        Object.entries(SECTOR_ETFS).map(([key, ticker]) => [ticker, key as keyof typeof SECTOR_ETFS])
      );
      for (const e of sectorsResult.value.errors) {
        sourceErrors.push({ source: `섹터(Yahoo):${e.sector}`, error: e.message });
        const ticker = e.sector.match(/\(([^)]+)\)$/)?.[1];
        const sectorKey = ticker ? tickerToKey.get(ticker) : undefined;
        if (!avApiKey || !sectorKey) {
          missingSectorLabels.push(e.sector);
          continue;
        }
        try {
          const fallback = await fetchSectorFallback(sectorKey, avApiKey);
          sectors.push({ ...fallback, source: "alphavantage" as const });
        } catch (err) {
          sourceErrors.push({ source: `AlphaVantage(섹터 폴백):${e.sector}`, error: err instanceof Error ? err.message : String(err) });
          missingSectorLabels.push(e.sector);
        }
        await alphaVantagePace();
      }
    }

    // 섹터 원자료(return5d·volumeRatio·전일 대비)는 지금까지 라이브 조회 전용이라 시계열로 안 남았다
    // — 6단계는 백테스트가 원천 불가능했다(외부 감사 지적). MetricValue에 티커별로 저장해두면
    // 나중에 scoreStep6 로직 변경(예: P0-3 분모 수정)의 과거 영향도 재계산해볼 수 있다.
    const sectorPoints: FetchedPoint[] = sectors.flatMap((s) => [
      { metric: `SECTOR_${s.ticker}_RET5D`, date: today, value: s.return5d, source: s.source },
      { metric: `SECTOR_${s.ticker}_VOLRATIO`, date: today, value: s.volumeRatio, source: s.source },
      { metric: `SECTOR_${s.ticker}_CHG1D`, date: today, value: s.changePct1d, source: s.source },
    ]);
    await saveMetricPoints(sectorPoints);

    // 2) 채점 — 뉴스·이벤트·엔화급등·공포탐욕지수 모두 위에서 이미 자동 동기화·계산됨.
    // 아래 전부(빅테크 등락원인·FINRA·DART·Put/Call·KRX) 리포트가 실제로 다루는 거래일(marketDate)
    // 기준으로 조회해야 한다 — "지금"(파이프라인 실행 시각, KST 오늘)으로 조회하면 리포트가 다루는
    // 날과 하루 어긋난다(실제 발견된 버그: date=8/8 리포트의 marketDate는 8/7인데 8/8로 조회해 다
    // "확인 못함"이 뜬 사례로 발견, 더 심각하게는 8/4~8/7도 조용히 하루 밀린 값을 보여주고 있었음.
    // 빅테크 등락원인도 같은 버그 클래스였다 — 이후 감사에서 발견해 같이 고침).
    const marketDateAnchor = new Date(`${marketDate}T12:00:00Z`);

    const { reasons: bigTechReasons, errors: bigTechErrors } = await computeBigTechReasons(BIG_TECH_TICKERS, marketDateAnchor);
    if (bigTechErrors.length) sourceErrors.push({ source: "빅테크 등락 원인(Claude)", error: bigTechErrors.join("; ") });

    const { signals: institutionalSignals, errors: institutionalErrors } = await computeInstitutionalSignals(
      BIG_TECH_TICKERS,
      process.env.DART_API_KEY,
      marketDateAnchor
    );
    if (institutionalErrors.length) sourceErrors.push({ source: "기관·내부자 매집(Dataroma/OpenInsider/FINRA/DART)", error: institutionalErrors.join("; ") });

    // Put/Call 비율(SPY) — HISTORICAL_PUT_CALL_RATIO를 marketDate로 앵커해서 조회한다(REALTIME이
    // 아니라 이걸 쓰는 이유: VIX·공포탐욕지수 등 7단계의 다른 모든 지표가 marketDate 기준인데
    // REALTIME만 "지금"을 보면 같은 표 안에서 기준일이 서로 달라진다). 절대 임계값이 아직
    // 검증 안 됐으므로 점수화하지 않고 7단계에 참고 정보로만 노출한다(institutionalSignals와
    // 같은 원칙 — 근거 없는 met 판정을 달지 않는다).
    let putCallRatio: number | null = null;
    if (avApiKey) {
      try {
        putCallRatio = await fetchHistoricalPutCallRatio(avApiKey, marketDate);
      } catch (err) {
        sourceErrors.push({ source: "Put/Call 비율(Alpha Vantage)", error: err instanceof Error ? err.message : String(err) });
      }
    }

    // KRX 공매도 잔고비중(KOSPI, 시가총액가중) — 공식 API엔 이 데이터가 없어서 실제 KRX 개인회원
    // 로그인 세션으로 조회한다(krx-short.ts 주석 참고). 로그인 자격증명이 없으면 조용히 건너뛴다.
    let krxShortBalance: { date: string; ratio: number } | null = null;
    const krxId = process.env.KRX_ID;
    const krxPw = process.env.KRX_PW;
    if (krxId && krxPw) {
      try {
        const summary = await fetchKrxShortBalanceSummary(krxId, krxPw, marketDateAnchor);
        if (summary) {
          krxShortBalance = { date: summary.date, ratio: summary.marketWeightedRatio };
          await saveMetricPoints([
            { metric: METRICS.KRX_SHORT_BALANCE_RATIO, date: summary.date, value: summary.marketWeightedRatio, source: "krx" },
          ]);
        }
      } catch (err) {
        sourceErrors.push({ source: "KRX 공매도 잔고비중", error: err instanceof Error ? err.message : String(err) });
      }
    }

    const report = await runDailyAnalysis({
      sectors,
      missingSectorLabels,
      bigTechReasons,
      institutionalSignals,
      putCallRatio,
      krxShortBalance,
    });

    if (putCallRatio !== null) {
      await saveMetricPoints([{ metric: METRICS.PUT_CALL_RATIO_SPY, date: today, value: putCallRatio, source: "alphavantage" }]);
    }
    finalDecision = report.step8.finalDecision;
    macroTrendScore = report.step8.macroTrendScore;

    // 뉴스 리스크 가중점수 시계열 저장 시작 — 지금 당장은 표본이 30개 미만이라 백분위 전환에
    // 못 쓰지만(calculatePercentile 최소 표본 요건), 쌓아두지 않으면 나중에도 영영 못 쓴다.
    if (report.step1.newsRiskScore !== undefined) {
      await saveMetricPoints([
        { metric: METRICS.NEWS_RISK_SCORE_7D, date: today, value: report.step1.newsRiskScore, source: "manual" },
      ]);
    }

    // /news 피드가 지금까지 구글 뉴스뿐이었는데, 이 사이트가 이미 매일 계산하는 FRED 경제지표
    // 발표 결과·FINRA/DART/Dataroma/OpenInsider 기관 동향도 "속보"로 반영한다. syncNewsPageHeadlines
    // (위 1단계 병렬 수집 블록)는 이 값들이 계산되기 전에 이미 끝나 있어 여기서 별도로 저장한다 —
    // 실패해도 리포트 저장 자체엔 영향 없게 sourceErrors에만 기록.
    try {
      const marketEventHeadlines = [
        ...buildEventOutcomeHeadlines(report.step1.recentEventOutcomes ?? [], today),
        ...buildInstitutionalHeadlines(institutionalSignals, new Date()),
      ];
      const { errors: marketEventErrors } = await saveMarketEventHeadlines(marketEventHeadlines);
      for (const e of marketEventErrors) sourceErrors.push({ source: "뉴스페이지(실데이터 속보)", error: e });
    } catch (err) {
      sourceErrors.push({ source: "뉴스페이지(실데이터 속보)", error: err instanceof Error ? err.message : String(err) });
    }

    // 3) 해설 생성
    try {
      narrative = await generateNarrative(buildDailyNarrativePrompt(report));
    } catch (err) {
      narrative = `[해설 생성 실패: ${err instanceof Error ? err.message : String(err)}]`;
    }

    try {
      report.details.comprehensiveReport = await generateComprehensiveReport(report);
    } catch (err) {
      report.details.comprehensiveReport = `[종합 보고서 생성 실패: ${err instanceof Error ? err.message : String(err)}]`;
    }

    // self-learning 페이지의 "학습 요약이 실제로 얼마나 반영되는가" 검증용 대조군 — 학습 요약만
    // 뺀 버전을 하나 더 생성해 나란히 저장한다. 실패해도 비교용일 뿐이라 본 리포트 저장은 막지 않는다.
    try {
      report.details.comprehensiveReportNoContext = await generateComprehensiveReport(report, { skipLearningContext: true });
    } catch (err) {
      sourceErrors.push({ source: "학습요약 A/B 비교(대조군)", error: err instanceof Error ? err.message : String(err) });
    }

    if (report.details.pptSlides && report.details.pptSlides.length > 0) {
      const headlines = await generatePptHeadlines(report.details.pptSlides);
      report.details.pptSlides = report.details.pptSlides.map((s) => ({ ...s, headline: headlines[s.step] ?? s.kicker }));
    }

    // 4) DB 저장 — create/update가 date를 빼면 완전히 같은 필드셋이라 한 번만 적어 재사용한다.
    const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
    const reportFields = {
      marketDate: new Date(marketDate),
      step1: asJson(report.step1), step2: asJson(report.step2), step3: asJson(report.step3), step4: asJson(report.step4),
      step5: asJson(report.step5), step6: asJson(report.step6), step7: asJson(report.step7), step8: asJson(report.step8),
      details: asJson(report.details),
      narrative,
      dataCompleteness: asJson({ sourceErrors }),
    };
    const savedReport = await db.dailyReport.upsert({
      where: { date: new Date(today) },
      create: { date: new Date(today), ...reportFields },
      update: reportFields,
    });

    // /report·홈은 이제 이 DB 스냅샷을 읽기 전용으로 쓴다(force-dynamic 제거) — 시간 기반 캐시
    // 대신 저장 직후 바로 무효화해서 스테일 0초로 최신 반영한다.
    revalidatePath("/report");
    revalidatePath("/");

    // 옵시디언(GitHub obsidian-export/) 반영을 별도 09:30 크론에만 맡기지 않고 리포트 저장 직후
    // 바로 시도한다 — 2026-08-13에 그 크론 자체가 그날 안 돌아서 반영이 하루 넘게 밀린 사고 실측
    // 이후 추가([[capital_flow_tracker_cron_reliability]]). 실패해도(토큰 없음·GitHub 장애) 리포트
    // 저장 자체는 이미 끝났으니 흐름을 막지 않고 sourceErrors에만 기록 — 09:30 크론이 다음 실행에서
    // 재시도하는 안전망 역할을 계속 한다.
    try {
      await exportDailyReportNow(savedReport);
    } catch (err) {
      sourceErrors.push({ source: "옵시디언export", error: err instanceof Error ? err.message : String(err) });
    }

    try {
      await sendReportUploadedAlert(marketDate, report.step8.finalDecision, report.step8.macroTrendScore);
    } catch (err) {
      sourceErrors.push({ source: "Discord알림", error: err instanceof Error ? err.message : String(err) });
    }

    // 5) 노션 기록 — 11개 하위 DB(상세) + Calender DB(시장 체크리스트 페이지에 실제로 보이는 항목)
    try {
      const notionInput = await buildNotionInput(today, report, sectors);
      const result = await writeDailyChecklistToNotion(notionInput);
      notionWriteCount = result.count;
    } catch (err) {
      sourceErrors.push({ source: "Notion(하위DB)", error: err instanceof Error ? err.message : String(err) });
    }
    try {
      await writeCalendarEntry({
        date: today,
        finalDecision: report.step8.finalDecision,
        macroTrendScore: report.step8.macroTrendScore,
        narrative,
      });
    } catch (err) {
      sourceErrors.push({ source: "Notion(캘린더)", error: err instanceof Error ? err.message : String(err) });
    }
  }

  // 6) 오늘이 주/월/분기/년 마감일이면 사이트 전용 주기별 리포트 생성 — isRepeatMarketDay와
  // 무관하게 항상 실행한다(위 주석 참고, 실제 라이브에서 확인된 회귀 수정).
  let periodReportsGenerated: string[] = [];
  try {
    const due = await generatePeriodReportsIfDue(new Date(today));
    periodReportsGenerated = due.filter((d) => d.generated).map((d) => d.type);
    for (const d of due.filter((x) => x.generated)) {
      revalidatePath(`/reports/${d.type}`);
    }
  } catch (err) {
    sourceErrors.push({ source: "주기별리포트", error: err instanceof Error ? err.message : String(err) });
  }

  // 위 377번 줄의 upsert 이후(옵시디언export·Discord알림·Notion·주기별리포트) push된 sourceErrors는
  // 지금까지 DB에 한 번도 다시 반영되지 않아 health-check가 절대 못 봤다(2026-08-22 감사로 확인) —
  // 감사 흔적용으로 최종 상태를 한 번 더 저장한다. 알림 트리거는 이 update가 아니라 각 실패 지점의
  // 즉시 알림(daily/route.ts, obsidian-export/route.ts)이 담당하므로, 이 update 자체가 실패해도
  // 조용히 넘어간다(리포트 저장은 이미 끝난 상태라 파이프라인을 막을 이유가 없다).
  try {
    const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
    await db.dailyReport.update({
      where: { date: new Date(today) },
      data: { dataCompleteness: asJson({ sourceErrors }) },
    });
  } catch {
    // DB 순단 등으로 이 마지막 저장까지 실패하면, 위에서 이미 시도한 즉시 알림 경로만 남는다.
  }

  return {
    date: today,
    metricsSaved,
    sourceErrors,
    narrative,
    finalDecision,
    macroTrendScore,
    notionWriteCount,
    periodReportsGenerated,
  };
}

// buildNotionInput 안에서 아직 실데이터 연동이 안 돼 항상 같은 문자열로 채워지는 자리표시자들 —
// 리터럴로 곳곳에 흩어져 있던 걸(코드 감사로 발견) 이름 붙여 한 곳에 모아뒀다. 나중에 실제 구현이
// 붙으면 이 두 상수를 참조하는 자리만 grep해서 찾으면 된다.
const NOT_AUTO_JUDGED = "자동 미판정"; // 한국은행 기준금리·국내 CPI — 자동 판정 로직 미구현
const NOT_TRACKED = "-"; // 전일/YTD 변동, 유가·환율 status — 원자료는 있으나 계산 미구현

async function buildNotionInput(
  date: string,
  report: Awaited<ReturnType<typeof runDailyAnalysis>>,
  sectors: { name: string; return5d: number; volumeRatio: number }[]
): Promise<DailyNotionInput> {
  const latest = async (metric: string) => db.metricValue.findFirst({ where: { metric }, orderBy: { date: "desc" } });

  const [walcl, m2, totresns, rrp, tga, realRate, creditSpread, gold, wti, brent, usdkrw, usdjpy, ndx, rut, dji, spx, vix] =
    await Promise.all(
      ["WALCL", "M2", "TOTRESNS", "RRP", "TGA", "REAL_RATE", "CREDIT_SPREAD", "GOLD", "WTI", "BRENT", "USDKRW", "USDJPY", "NDX", "RUT", "DJI", "SPX", "VIX"].map(latest)
    );
  const foreignNetBuyRecent = await db.metricValue.findMany({
    where: { metric: METRICS.FOREIGN_NET_BUY_KOSPI },
    orderBy: { date: "desc" },
    take: 5,
  });
  const foreignNetBuy5dEok =
    foreignNetBuyRecent.length === 5
      ? foreignNetBuyRecent.reduce((sum, r) => sum + r.value, 0) / 100 // 백만원 -> 억원
      : null;

  return {
    date,
    geopolitics: report.step1.riskyNews.length > 0
      ? {
          summary: report.step1.riskyNews.map((n) => n.summary).join(" / "),
          link: report.step1.riskyNews[0].url,
          risky: true,
        }
      : { summary: "LLM 판정 결과 리스크 뉴스 없음", link: null, risky: false },
    domesticLiquidity: [
      { name: "한국은행 기준금리", condition: "인하 또는 동결 흐름", status: NOT_AUTO_JUDGED },
      { name: "국내 CPI", condition: "목표치(2%) 근접 추세", status: NOT_AUTO_JUDGED },
      {
        name: "외국인 순매수(코스피)",
        condition: "5거래일 누적 순매수",
        status: foreignNetBuy5dEok !== null
          ? `${foreignNetBuy5dEok >= 0 ? "+" : ""}${foreignNetBuy5dEok.toLocaleString()}억원`
          : "확인 못함",
      },
    ],
    fredIndicators: [
      { name: "WALCL", condition: "규모 증가", status: walcl ? `${walcl.value.toLocaleString()}` : "확인 못함", qualifies: !!report.step2.overseasQualifyingCount },
      { name: "M2", condition: "2달 연속 증가율 상승", status: m2 ? `${m2.value}` : "확인 못함", qualifies: false },
      { name: "기준잔액(WRESBAL)", condition: "4주 연속 증가", status: totresns ? `${totresns.value}` : "확인 못함", qualifies: false },
      { name: "RRP", condition: "지속 감소", status: rrp ? `${rrp.value}` : "확인 못함", qualifies: false },
      { name: "TGA", condition: "지속 감소", status: tga ? `${tga.value}` : "확인 못함", qualifies: false },
      { name: "실질금리(10년물)", condition: "하락 또는 낮은 데서 횡보", status: realRate ? `${realRate.value}%` : "확인 못함", qualifies: false },
      { name: "크레딧 스프레드", condition: "축소", status: creditSpread ? `${creditSpread.value}` : "확인 못함", qualifies: false },
    ],
    carryTrade: {
      spreadBp: report.step3.spreadBp,
      change: report.step3.warning ?? "-",
      status: `${report.step3.zone} (${report.step3.spreadBp}bp)`,
    },
    oil: [
      { name: "WTI", priceChange: wti ? `$${wti.value.toFixed(2)}` : "확인 못함", status: NOT_TRACKED },
      { name: "브렌트", priceChange: brent ? `$${brent.value.toFixed(2)}` : "확인 못함", status: NOT_TRACKED },
    ],
    gold: { priceChange: gold ? `$${gold.value.toFixed(2)}` : "확인 못함", status: report.step4.quadrant },
    fx: [
      { name: "USD/KRW", priceChange: usdkrw ? usdkrw.value.toFixed(2) : "확인 못함", status: NOT_TRACKED },
      { name: "USD/JPY", priceChange: usdjpy ? usdjpy.value.toFixed(2) : "확인 못함", status: "3단계 결과 참고" },
    ],
    indices: [
      { name: "나스닥100(NDX)", close: ndx ? ndx.value.toFixed(0) : "확인 못함", dayChange: NOT_TRACKED, prevChange: NOT_TRACKED, ytdChange: NOT_TRACKED },
      { name: "러셀2000(RUT)", close: rut ? rut.value.toFixed(0) : "확인 못함", dayChange: NOT_TRACKED, prevChange: NOT_TRACKED, ytdChange: NOT_TRACKED },
      { name: "다우존스(DJI)", close: dji ? dji.value.toFixed(0) : "확인 못함", dayChange: NOT_TRACKED, prevChange: NOT_TRACKED, ytdChange: NOT_TRACKED },
      { name: "S&P500(SPX)", close: spx ? spx.value.toFixed(0) : "확인 못함", dayChange: NOT_TRACKED, prevChange: NOT_TRACKED, ytdChange: NOT_TRACKED },
      { name: "VIX", close: vix ? vix.value.toFixed(2) : "확인 못함", dayChange: NOT_TRACKED, prevChange: NOT_TRACKED, ytdChange: NOT_TRACKED },
    ],
    sectors: sectors.map((s) => ({
      name: s.name,
      return: `${s.return5d.toFixed(2)}%`,
      note: report.step6.qualifying.includes(s.name) ? "숫자 기준 충족" : "미충족",
    })),
    smartMoney: [{ name: "비트코인 ETF 자금흐름", note: "자동 미연동 — Farside/SoSoValue 수동 확인 필요" }],
    sentiment: [
      { name: "VIX", cause: vix ? `${vix.value.toFixed(2)}` : "확인 못함" },
      { name: "CNN 공포와 탐욕", cause: "자동 미연동 — 수동 확인 필요" },
    ],
  };
}
