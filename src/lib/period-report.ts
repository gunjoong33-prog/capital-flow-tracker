import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { generateNarrative } from "@/lib/narrative";
import type { Step1Result, Step2Result, Step3Result, Step4Result, Step5Result, Step6Result, Step8Result } from "@/lib/scoring/types";

export type PeriodType = "week" | "month" | "quarter" | "year";

const PERIOD_LABEL: Record<PeriodType, string> = {
  week: "주간", month: "월간", quarter: "분기", year: "연간",
};

// 원래 유동성(2단계, 가중치 2.5 — 이 사이트의 1순위 드라이버) 핵심 지표가 하나도 없었다(외부 지적,
// 실제 확인) — RRP·TGA·크레딧 스프레드·실질금리·기준잔액을 추가한다.
const TREND_METRICS = [
  "WALCL", "M2", "TOTRESNS", "RRP", "TGA", "REAL_RATE", "CREDIT_SPREAD", // 유동성(핵심)
  "US10Y", "JP10Y", "USDJPY", "USDKRW", "DXY", // 캐리·환율
  "SPX", "NDX", "RUT", "DJI", "BTC", "GOLD", "WTI", "VIX", // 자산가격
];

function utc(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d));
}

/**
 * 각 주기 리포트를 실행해야 하는 "실시일"인지 판정 — 주기가 끝난 다음날(=다음 주기 첫날)에 실행한다.
 * week: 매주 일요일(월~토 6일을 종합) / month: 매월 1일(지난달 종합)
 * quarter: 매분기 첫날(지난 분기 종합) / year: 매년 1월 1일(작년 종합)
 */
export function isReportDay(type: PeriodType, date: Date): boolean {
  if (type === "week") return date.getUTCDay() === 0;
  if (type === "month") return date.getUTCDate() === 1;
  if (type === "quarter") return date.getUTCDate() === 1 && date.getUTCMonth() % 3 === 0;
  return date.getUTCMonth() === 0 && date.getUTCDate() === 1;
}

/** 실시일(reportDate) 기준으로 방금 끝난 직전 주기의 [start, end]를 계산한다. */
export function getPrecedingPeriodBounds(type: PeriodType, reportDate: Date): { start: Date; end: Date } {
  const y = reportDate.getUTCFullYear();
  const m = reportDate.getUTCMonth();
  const d = reportDate.getUTCDate();

  if (type === "week") {
    // reportDate = 일요일. 직전 월~토(6일).
    return { start: utc(y, m, d - 6), end: utc(y, m, d - 1) };
  }
  if (type === "month") {
    // reportDate = 매월 1일. 지난달 전체(JS Date가 음수 달을 자동으로 이전 해로 넘겨준다).
    return { start: utc(y, m - 1, 1), end: utc(y, m, 0) };
  }
  if (type === "quarter") {
    // reportDate = 분기 첫날. 지난 분기 전체(3개월).
    return { start: utc(y, m - 3, 1), end: utc(y, m, 0) };
  }
  // year: reportDate = 1월 1일. 작년 전체.
  return { start: utc(y - 1, 0, 1), end: utc(y - 1, 11, 31) };
}

interface AggregatedBase {
  daysWithData: number;
  avgMacroTrendScore: number | null;
  firstScore: number | null;
  lastScore: number | null;
  decisionCounts: Record<string, number>;
  avgStepScores: {
    liquidity: number | null; // 2단계, 가중치 2.5
    carry: number | null; // 3단계
    fxGoldOil: number | null; // 4단계
    flows: number | null; // 5단계
    sectors: number | null; // 6단계
  };
  vetoDays: number; // 1단계 거부권 발동 일수
  jpySpikeDays: number; // 엔화 변동성 급등 감지 일수
  quadrantCounts: Record<string, number>; // 4단계 사분면 분포
  topSectors: Record<string, number>; // 6단계 충족 섹터별 등장 횟수
}

async function metricChangePct(metric: string, start: Date, end: Date): Promise<number | null> {
  const [first, last] = await Promise.all([
    db.metricValue.findFirst({ where: { metric, date: { gte: start, lte: end } }, orderBy: { date: "asc" } }),
    db.metricValue.findFirst({ where: { metric, date: { gte: start, lte: end } }, orderBy: { date: "desc" } }),
  ]);
  if (!first || !last || first.value === 0) return null;
  return Number((((last.value - first.value) / Math.abs(first.value)) * 100).toFixed(2));
}

function avg(nums: number[]): number | null {
  return nums.length > 0 ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)) : null;
}

/**
 * 모든 주기(주/월/분기/년) 공통 — DailyReport를 [start,end]로 직접 집계한다.
 * 예전엔 월/분기/연간이 하위 PeriodReport(주/월)를 다시 집계하는 계층 구조였는데, 두 가지 버그가
 * 있었다(외부 지적, 코드로 실제 확인): ① 주마다 daysWithData가 다른데 가중치 없이 단순평균했고,
 * ② 하위 주가 상위 기간 경계를 걸치면(예: 월~토가 7/27~8/1인 주) periodStart 기준 필터 때문에
 * 시작월(7월)로만 통째로 귀속돼 다음 달(8월) 첫날 데이터가 그 달 집계에서 통째로 빠졌다.
 * DailyReport에서 매번 직접 뽑으면 두 문제 다 원천적으로 없다 — 연간이라도 365행 이내라
 * 계산량 문제도 없다(외부 제안, 검토 후 채택).
 */
async function aggregateFromDaily(start: Date, end: Date): Promise<AggregatedBase> {
  const dailyReports = await db.dailyReport.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
    select: { date: true, step1: true, step2: true, step3: true, step4: true, step5: true, step6: true, step8: true },
  });

  const scores = dailyReports.map((r) => (r.step8 as unknown as Step8Result).macroTrendScore);
  const decisions = dailyReports.map((r) => (r.step8 as unknown as Step8Result).finalDecision);
  const decisionCounts = decisions.reduce<Record<string, number>>((acc, dcn) => {
    acc[dcn] = (acc[dcn] ?? 0) + 1;
    return acc;
  }, {});

  const quadrantCounts: Record<string, number> = {};
  const topSectors: Record<string, number> = {};
  let vetoDays = 0;
  let jpySpikeDays = 0;
  for (const r of dailyReports) {
    const step1 = r.step1 as unknown as Step1Result;
    const step3 = r.step3 as unknown as Step3Result;
    const step4 = r.step4 as unknown as Step4Result;
    const step6 = r.step6 as unknown as Step6Result;
    if (step1?.vetoTriggered) vetoDays++;
    if (step3?.warning) jpySpikeDays++;
    if (step4?.quadrant) quadrantCounts[step4.quadrant] = (quadrantCounts[step4.quadrant] ?? 0) + 1;
    for (const s of step6?.qualifying ?? []) topSectors[s] = (topSectors[s] ?? 0) + 1;
  }

  return {
    daysWithData: dailyReports.length,
    avgMacroTrendScore: avg(scores),
    firstScore: scores[0] ?? null,
    lastScore: scores[scores.length - 1] ?? null,
    decisionCounts,
    avgStepScores: {
      liquidity: avg(dailyReports.map((r) => (r.step2 as unknown as Step2Result).finalScore)),
      carry: avg(dailyReports.map((r) => (r.step3 as unknown as Step3Result).score)),
      fxGoldOil: avg(dailyReports.map((r) => (r.step4 as unknown as Step4Result).score)),
      flows: avg(dailyReports.map((r) => (r.step5 as unknown as Step5Result).score)),
      sectors: avg(dailyReports.map((r) => (r.step6 as unknown as Step6Result).score)),
    },
    vetoDays,
    jpySpikeDays,
    quadrantCounts,
    topSectors,
  };
}

export async function aggregatePeriod(type: PeriodType, reportDate: Date) {
  const { start, end } = getPrecedingPeriodBounds(type, reportDate);
  const base = await aggregateFromDaily(start, end);

  const metricChanges: Record<string, number | null> = {};
  for (const metric of TREND_METRICS) {
    metricChanges[metric] = await metricChangePct(metric, start, end);
  }

  return {
    periodType: type,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    ...base,
    metricChangesPct: metricChanges,
  };
}

// 일간 종합 보고서(comprehensive-report.ts)와 같은 5단 구조(원인→환경→이동→전망→판단)로
// 내용 순서는 통일하되, 가독성을 위해 형식은 다르게 간다 — 일간은 문단으로 길게 흐르는 산문체지만
// 여기는 "한 줄에 한 문장씩" 요구를 받아 tips.ts·종합판단 박스와 같은 방식으로 바꾼다(사용자 지적,
// 실제 확인 — 기존엔 UI(reports/[type]/[start]/page.tsx)에 whitespace-pre-line도 없어서 설령
// 줄바꿈을 넣어도 화면에서 다 붙어버렸다, 같이 수정함). 일간과 달리 "예측"에 해당하는 재료가
// firstScore→lastScore 방향성 하나뿐이라 ④ 항목은 그만큼 짧게 쓰도록 명시한다.
function buildPeriodNarrativePrompt(summary: Awaited<ReturnType<typeof aggregatePeriod>>): string {
  return `너는 매크로 자본흐름을 직접 챙겨보는 개인 투자자이고, 지금 쓰는 글은 자기 자신에게 존댓말로
보고하는 ${PERIOD_LABEL[summary.periodType]} 브리핑이다(반말로 쓰는 사적인 일기가 아니다). 아래는
${summary.start} ~ ${summary.end} 기간 동안 집계된 데이터(JSON)다.

*** 문체 규칙(가장 중요, 다른 모든 규칙보다 우선) ***
- 출력하는 모든 문장은 예외 없이 "~습니다/~입니다/~합니다/~했습니다/~겠습니다" 같은 존댓말(합니다체)로
  끝나야 한다. "~다/~였다/~한다/~하다/~겠다"처럼 "다"로 끝나는 평서체 문장은 단 하나도 섞이면 안 된다.
- 문장이 끝날 때마다 반드시 줄바꿈해라 — 한 줄에 문장 하나만 오게 써라. 두 문장을 한 줄에 이어
  쓰거나 문단처럼 길게 흘려 쓰지 마라(일간 종합 보고서와 다른 부분이니 특히 주의해라).

원칙
- 집계 JSON에 없는 숫자나 사실을 지어내지 마라. daysWithData가 적으면 그 사실을 먼저 밝혀라.
- 하루치 사건이 아니라 "이 기간 전체의 흐름"을 써라 — firstScore에서 lastScore로 어떻게
  달라졌는지, decisionCounts가 며칠씩 나뉘었는지가 핵심이다.
- 단계 번호("2단계" 등)를 쓰지 말고 "유동성", "캐리 트레이드"처럼 내용으로 불러라.
- 다섯 덩어리 사이에는 빈 줄을 하나씩 넣어 구분하되, 소제목은 달지 마라.

다뤄야 할 내용 — 아래 다섯 덩어리를 이 순서대로, 각 덩어리는 한 줄에 한 문장씩 여러 줄로 써라.
① 이 기간 자본을 움직인 가장 큰 요인은 무엇이었는지.
   거부권 발동 일수(vetoDays)가 기간의 절반을 넘으면 그 자체가 이 기간의 성격이다.
   엔화 변동성 급등 감지 일수(jpySpikeDays)가 있으면 반드시 짚어라.
② 이 기간이 자산 가격을 들어올리기 좋은 환경이었는지.
   유동성 평균 점수(avgStepScores.liquidity)와 metricChangesPct의 WALCL·RRP·TGA·
   CREDIT_SPREAD·REAL_RATE 변화율을 근거로 판정해라. 캐리 트레이드 평균 점수
   (avgStepScores.carry)도 함께 다뤄라 — 이것도 자산을 떠받치는 자금원이기 때문이다.
③ 자본이 실제로 어디로 갔는지.
   지수별 변화율(SPX·NDX·RUT·DJI)과 금·달러·비트코인의 방향, 이 기간 가장 자주 충족된
   섹터(topSectors)를 종합해 지목해라. 사분면 분포(quadrantCounts)가 한쪽으로 쏠렸으면
   그 국면이 기간 내내 지속됐는지도 짚어라. ②의 환경 판정과 ③의 실제 이동이 어긋나면
   반드시 짚어라 — 환경은 나쁜데 자금은 들어왔거나, 환경은 좋은데 안 들어왔다면 그게
   이 기간 가장 중요한 관찰이다.
④ 다음 기간에 자본이 어디로 갈 가능성이 있는지.
   *** 집계에 있는 추세로만 조건문으로 써라. 그 밖의 예측은 절대 하지 마라. *** 점수가
   firstScore에서 lastScore로 어느 방향으로 움직였는지가 사실상 유일한 추세 재료다.
   단정하지 마라 — 재료가 얇으면 "지금 데이터로는 방향을 좁히기 어렵습니다"라고 쓰는 게
   지어내는 것보다 낫다.
⑤ 이 기간을 통틀어 주식시장에 들어가기 좋았는지, 그리고 지금은 어떤지.
   평균 점수(avgMacroTrendScore)와 판정 분포(decisionCounts)를 근거로 담백하게 정리해라.
   매번 같은 문장으로 끝내지 말고 이 기간 상황에 맞는 대응 한 문장으로 마무리해라.

마지막으로 다시 한번: 문장이 끝날 때마다 줄바꿈해라. 한 줄에 문장 하나뿐이어야 한다.

집계 JSON:
${JSON.stringify(summary, null, 2)}`;
}

export async function generateAndSavePeriodReport(type: PeriodType, reportDate: Date) {
  const summary = await aggregatePeriod(type, reportDate);
  let narrative: string;
  try {
    narrative = await generateNarrative(buildPeriodNarrativePrompt(summary));
  } catch (err) {
    narrative = `[해설 생성 실패: ${err instanceof Error ? err.message : String(err)}]`;
  }

  const { start, end } = getPrecedingPeriodBounds(type, reportDate);
  await db.periodReport.upsert({
    where: { periodType_periodStart: { periodType: type, periodStart: start } },
    create: { periodType: type, periodStart: start, periodEnd: end, summary: summary as unknown as Prisma.InputJsonValue, narrative },
    update: { periodEnd: end, summary: summary as unknown as Prisma.InputJsonValue, narrative },
  });

  return summary;
}

/**
 * 오늘 날짜 기준으로 실시일인 모든 주기(주/월/분기/년)를 검사해 필요한 것만 생성한다.
 * week -> month -> quarter -> year 순서로 처리해서, 상위 주기가 방금 저장된 하위 주기 리포트를
 * 바로 참조할 수 있게 한다(같은 날 여러 주기가 동시에 실시일일 수 있음, 예: 1월 1일).
 */
export async function generatePeriodReportsIfDue(today: Date) {
  const results: { type: PeriodType; generated: boolean }[] = [];
  for (const type of ["week", "month", "quarter", "year"] as PeriodType[]) {
    if (isReportDay(type, today)) {
      await generateAndSavePeriodReport(type, today);
      results.push({ type, generated: true });
    } else {
      results.push({ type, generated: false });
    }
  }
  return results;
}
