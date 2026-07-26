import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { saveMetricPoints } from "@/lib/metrics";
import { fetchAllFredMetrics } from "@/lib/sources/fred";
import { fetchCftcJpyNetPositionLatest } from "@/lib/sources/cftc";
import { fetchCoinGeckoLatest } from "@/lib/sources/coingecko";
import { fetchJp10yLatest } from "@/lib/sources/mof-japan";
import { fetchAllYahooLatest, fetchAllSectors } from "@/lib/sources/yahoo";
import { fetchKr10y } from "@/lib/sources/ecos";
import { runDailyAnalysis } from "@/lib/scoring/run";
import { generateNarrative, buildDailyNarrativePrompt } from "@/lib/narrative";
import { writeDailyChecklistToNotion, writeCalendarEntry, type DailyNotionInput } from "@/lib/notion-write";
import { generatePeriodReportsIfDue } from "@/lib/period-report";
import { getManualInputsForDate } from "@/lib/manual-inputs";
import { syncMajorEvents } from "@/lib/major-events";
import { syncNewsEvents } from "@/lib/news-events";
import { computeBigTechReasons } from "@/lib/bigtech-reasons";
import { computeInstitutionalSignals } from "@/lib/institutional-signals";
import { BIG_TECH_TICKERS, type FetchedPoint } from "@/lib/sources/types";

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

/**
 * 매일 아침 9시(KST) 실행되는 전체 파이프라인.
 * 1) 데이터 수집 2) 채점 3) 해설 생성 4) DB 저장 5) 노션 기록
 *
 * 뉴스 판단·엔화 변동성 급등·심리지수(CNN F&G)는 자동 소스가 없어 아직 기본값(placeholder)이다 —
 * 지난 감사에서 정한 원칙대로, 없는 데이터는 지어내지 않고 "미확인"으로 남겨둔다.
 */
export async function runDailyPipeline(): Promise<DailyPipelineResult> {
  const today = new Date().toISOString().slice(0, 10);
  const sourceErrors: { source: string; error: string }[] = [];
  const allPoints: FetchedPoint[] = [];

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  // 1) 데이터 수집 — 서로 독립적인 소스라 병렬로 실행 (뉴스 판정·주요 이벤트 동기화도 여기 포함)
  const [
    fredResult, cftcResult, coingeckoResult, jp10yResult, yahooResult, sectorsResult,
    kr10yResult, majorEventsResult, newsEventsResult,
  ] = await Promise.allSettled([
      process.env.FRED_API_KEY
        ? fetchAllFredMetrics(process.env.FRED_API_KEY, sevenDaysAgoStr)
        : Promise.resolve({ points: [], errors: [{ metric: "FRED", message: "FRED_API_KEY 없음" }] }),
      fetchCftcJpyNetPositionLatest(),
      fetchCoinGeckoLatest(),
      fetchJp10yLatest(),
      fetchAllYahooLatest(),
      fetchAllSectors(),
      process.env.ECOS_API_KEY ? fetchKr10y(process.env.ECOS_API_KEY, sevenDaysAgo) : Promise.resolve([]),
      syncMajorEvents(),
      syncNewsEvents(),
    ]);

  if (majorEventsResult.status === "fulfilled") {
    for (const e of majorEventsResult.value.errors) sourceErrors.push({ source: "주요이벤트일정", error: e });
  } else sourceErrors.push({ source: "주요이벤트일정", error: String(majorEventsResult.reason) });

  if (newsEventsResult.status === "fulfilled") {
    for (const e of newsEventsResult.value.errors) sourceErrors.push({ source: "뉴스판정", error: e });
  } else sourceErrors.push({ source: "뉴스판정", error: String(newsEventsResult.reason) });

  if (fredResult.status === "fulfilled") {
    allPoints.push(...fredResult.value.points);
    for (const e of fredResult.value.errors) sourceErrors.push({ source: `FRED:${e.metric}`, error: e.message });
  } else sourceErrors.push({ source: "FRED", error: String(fredResult.reason) });

  if (cftcResult.status === "fulfilled" && cftcResult.value) allPoints.push(cftcResult.value);
  else if (cftcResult.status === "rejected") sourceErrors.push({ source: "CFTC", error: String(cftcResult.reason) });

  if (coingeckoResult.status === "fulfilled") allPoints.push(...coingeckoResult.value);
  else sourceErrors.push({ source: "CoinGecko", error: String(coingeckoResult.reason) });

  if (jp10yResult.status === "fulfilled") allPoints.push(...jp10yResult.value);
  else sourceErrors.push({ source: "MOF(JP10Y)", error: String(jp10yResult.reason) });

  if (yahooResult.status === "fulfilled") {
    allPoints.push(...yahooResult.value.points);
    for (const e of yahooResult.value.errors) sourceErrors.push({ source: `Yahoo:${e.metric}`, error: e.message });
  } else sourceErrors.push({ source: "Yahoo", error: String(yahooResult.reason) });

  if (kr10yResult.status === "fulfilled") allPoints.push(...kr10yResult.value);

  const metricsSaved = await saveMetricPoints(allPoints);

  const sectors =
    sectorsResult.status === "fulfilled"
      ? sectorsResult.value.map((s) => ({ name: s.name, return5d: s.return5d, changePct1d: s.changePct1d, volumeRatio: s.volumeRatio }))
      : [];
  if (sectorsResult.status === "rejected") sourceErrors.push({ source: "섹터(Yahoo)", error: String(sectorsResult.reason) });

  // 2) 채점 — 뉴스·이벤트·엔화급등은 위에서 이미 동기화·계산됨. CNN F&G만 여전히 수동.
  const manualInputs = await getManualInputsForDate(today);
  const { reasons: bigTechReasons, errors: bigTechErrors } = await computeBigTechReasons(BIG_TECH_TICKERS);
  if (bigTechErrors.length) sourceErrors.push({ source: "빅테크 등락 원인(Gemini)", error: bigTechErrors.join("; ") });
  const { signals: institutionalSignals, errors: institutionalErrors } = await computeInstitutionalSignals();
  if (institutionalErrors.length) sourceErrors.push({ source: "기관·내부자 매집(Dataroma/OpenInsider)", error: institutionalErrors.join("; ") });
  const report = await runDailyAnalysis({
    fearGreed: manualInputs.fearGreed,
    sectors,
    bigTechReasons,
    institutionalSignals,
  });

  // 3) 해설 생성
  let narrative: string;
  try {
    narrative = await generateNarrative(buildDailyNarrativePrompt(report));
  } catch (err) {
    narrative = `[해설 생성 실패: ${err instanceof Error ? err.message : String(err)}]`;
  }

  // 4) DB 저장
  const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
  await db.dailyReport.upsert({
    where: { date: new Date(today) },
    create: {
      date: new Date(today),
      step1: asJson(report.step1), step2: asJson(report.step2), step3: asJson(report.step3), step4: asJson(report.step4),
      step5: asJson(report.step5), step6: asJson(report.step6), step7: asJson(report.step7), step8: asJson(report.step8),
      details: asJson(report.details),
      narrative,
      dataCompleteness: asJson({ sourceErrors }),
    },
    update: {
      step1: asJson(report.step1), step2: asJson(report.step2), step3: asJson(report.step3), step4: asJson(report.step4),
      step5: asJson(report.step5), step6: asJson(report.step6), step7: asJson(report.step7), step8: asJson(report.step8),
      details: asJson(report.details),
      narrative,
      dataCompleteness: asJson({ sourceErrors }),
    },
  });

  // 5) 노션 기록 — 11개 하위 DB(상세) + Calender DB(시장 체크리스트 페이지에 실제로 보이는 항목)
  let notionWriteCount = 0;
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

  // 6) 오늘이 주/월/분기/년 마감일이면 사이트 전용 주기별 리포트 생성
  let periodReportsGenerated: string[] = [];
  try {
    const due = await generatePeriodReportsIfDue(new Date(today));
    periodReportsGenerated = due.filter((d) => d.generated).map((d) => d.type);
  } catch (err) {
    sourceErrors.push({ source: "주기별리포트", error: err instanceof Error ? err.message : String(err) });
  }

  return {
    date: today,
    metricsSaved,
    sourceErrors,
    narrative,
    finalDecision: report.step8.finalDecision,
    macroTrendScore: report.step8.macroTrendScore,
    notionWriteCount,
    periodReportsGenerated,
  };
}

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

  return {
    date,
    geopolitics: report.step1.riskyNews.length > 0
      ? {
          summary: report.step1.riskyNews.map((n) => n.summary).join(" / "),
          link: report.step1.riskyNews[0].url,
          risky: true,
        }
      : { summary: "Gemini 판정 결과 리스크 뉴스 없음", link: null, risky: false },
    domesticLiquidity: [
      { name: "한국은행 기준금리", condition: "인하 또는 동결 흐름", status: "자동 미판정" },
      { name: "국내 CPI", condition: "목표치(2%) 근접 추세", status: "자동 미판정" },
      { name: "외국인 순매수(코스피)", condition: "5거래일 누적 순매수", status: "자동 미판정" },
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
      { name: "WTI", priceChange: wti ? `$${wti.value.toFixed(2)}` : "확인 못함", status: "-" },
      { name: "브렌트", priceChange: brent ? `$${brent.value.toFixed(2)}` : "확인 못함", status: "-" },
    ],
    gold: { priceChange: gold ? `$${gold.value.toFixed(2)}` : "확인 못함", status: report.step4.quadrant },
    fx: [
      { name: "USD/KRW", priceChange: usdkrw ? usdkrw.value.toFixed(2) : "확인 못함", status: "-" },
      { name: "USD/JPY", priceChange: usdjpy ? usdjpy.value.toFixed(2) : "확인 못함", status: "3단계 결과 참고" },
    ],
    indices: [
      { name: "나스닥100(NDX)", close: ndx ? ndx.value.toFixed(0) : "확인 못함", dayChange: "-", prevChange: "-", ytdChange: "-" },
      { name: "러셀2000(RUT)", close: rut ? rut.value.toFixed(0) : "확인 못함", dayChange: "-", prevChange: "-", ytdChange: "-" },
      { name: "다우존스(DJI)", close: dji ? dji.value.toFixed(0) : "확인 못함", dayChange: "-", prevChange: "-", ytdChange: "-" },
      { name: "S&P500(SPX)", close: spx ? spx.value.toFixed(0) : "확인 못함", dayChange: "-", prevChange: "-", ytdChange: "-" },
      { name: "VIX", close: vix ? vix.value.toFixed(2) : "확인 못함", dayChange: "-", prevChange: "-", ytdChange: "-" },
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
