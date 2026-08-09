import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { generateNarrative } from "@/lib/narrative";
import type { Step1Result, Step2Result, Step3Result, Step4Result, Step5Result, Step6Result, Step8Result } from "@/lib/scoring/types";
import { collapseRepeatedDots } from "@/lib/text-format";

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

// LLM에게 원자료 코드명(WALCL, RRP 등)을 그대로 던지면 프롬프트로 "한글로 불러라"라고 아무리
// 지시해도 그 코드를 그대로 베껴 쓰는 경우가 많다(comprehensive-report.ts의 stripStepNumbers()와
// 같은 문제·같은 해법) — JSON을 보내기 전에 키 자체를 한글 이름으로 바꿔서 원천 차단한다.
// 종합보고서 수준을 "고등학생도 이해할 수 있게" 낮추라는 요청에 맞춰, 생소할 만한 용어는 괄호로
// 짧은 설명을 같이 붙인다.
const METRIC_LABELS: Record<string, string> = {
  WALCL: "연준 대차대조표(중앙은행이 시중에 푼 돈의 총량)",
  M2: "M2 통화량",
  TOTRESNS: "은행 지급준비금",
  RRP: "역레포(은행들이 하루짜리로 연준에 맡겨두는 돈, 늘면 시중에 도는 돈은 준다)",
  TGA: "재무부 일반계정(정부가 연준에 둔 통장 잔액)",
  REAL_RATE: "실질금리(물가상승률을 뺀 진짜 금리)",
  CREDIT_SPREAD: "크레딧 스프레드(회사채가 국채보다 얼마나 위험하게 보이는지)",
  US10Y: "미국 10년물 국채금리",
  JP10Y: "일본 10년물 국채금리",
  USDJPY: "엔/달러 환율",
  USDKRW: "원/달러 환율",
  DXY: "달러 인덱스(달러가 다른 주요국 통화 대비 강한지)",
  SPX: "S&P500",
  NDX: "나스닥100",
  RUT: "러셀2000(미국 중소형주 지수)",
  DJI: "다우존스",
  BTC: "비트코인",
  GOLD: "금값",
  WTI: "WTI 국제유가",
  VIX: "VIX(월가 변동성·공포 지수)",
};

function relabelMetrics(pct: Record<string, number | null>): Record<string, number | null> {
  return Object.fromEntries(Object.entries(pct).map(([code, v]) => [METRIC_LABELS[code] ?? code, v]));
}

// 크레딧 스프레드·실질금리·국채금리·VIX는 원자료 자체가 이미 %(또는 포인트) 단위라, "값이 몇 %
// 움직였는지"(상대 변화율)와 "몇 bp/포인트 움직였는지"(절대 변화폭)가 전혀 다른 얘기가 된다 —
// 281bp였던 크레딧 스프레드가 284bp가 된 걸 metricChangesPct는 "+1.07%"로만 보여주는데, 이걸
// 그대로 "1.07% 상승"이라고 쓰면 스프레드가 1%p(100bp)나 벌어진 것처럼 오해하기 쉽다(사용자
// 지적, 실제 확인 — 3bp 움직임을 %만 보고 "신용 경색 우려"로 과장해 서술한 사례). 그래서 이
// 5개 지표는 절대 변화폭(bp 또는 포인트)도 따로 계산해서 LLM에게 같이 준다.
export const RATE_TYPE_METRICS = new Set(["CREDIT_SPREAD", "REAL_RATE", "US10Y", "JP10Y", "VIX"]);

/** 구간 [start,end] 안에서 가장 이른/가장 늦은 MetricValue를 함께 조회한다(metricPointChange·metricChangePct 공용). */
async function getFirstLastMetricValues(metric: string, start: Date, end: Date) {
  const [first, last] = await Promise.all([
    db.metricValue.findFirst({ where: { metric, date: { gte: start, lte: end } }, orderBy: { date: "asc" } }),
    db.metricValue.findFirst({ where: { metric, date: { gte: start, lte: end } }, orderBy: { date: "desc" } }),
  ]);
  return { first, last };
}

async function metricPointChange(metric: string, start: Date, end: Date): Promise<number | null> {
  const { first, last } = await getFirstLastMetricValues(metric, start, end);
  if (!first || !last) return null;
  const raw = last.value - first.value;
  // VIX는 지수 자체가 "포인트" 단위로 흔히 불린다(예: "15.99"). 나머지 4개는 원자료가 소수 %라
  // ×100 해서 bp로 바꾼다(0.03 → 3bp).
  return metric === "VIX" ? Number(raw.toFixed(2)) : Number((raw * 100).toFixed(1));
}

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
  const { first, last } = await getFirstLastMetricValues(metric, start, end);
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
  const metricPointChanges: Record<string, number | null> = {};
  for (const metric of TREND_METRICS) {
    metricChanges[metric] = await metricChangePct(metric, start, end);
    if (RATE_TYPE_METRICS.has(metric)) {
      metricPointChanges[metric] = await metricPointChange(metric, start, end);
    }
  }

  return {
    periodType: type,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    ...base,
    metricChangesPct: metricChanges,
    metricPointChangesBp: metricPointChanges,
  };
}

// gemini-flash-latest·Mistral 계열 모두 4~5문단짜리 긴 글을 다 채우려면 2048로는 부족하다는 걸
// comprehensive-report.ts(일간)에서 이미 확인했다 — 같은 여유(8192)를 준다.
const COMPREHENSIVE_MAX_OUTPUT_TOKENS = 8192;

/**
 * 일간 종합보고서(comprehensive-report.ts)와 완전히 같은 문체·깊이·5단 구조(원인→환경→이동→전망→
 * 판단, 문단체, 합니다체, 소제목 없이 흐름으로만 구분)를 기간 집계 데이터에 맞춰 그대로 적용한다.
 * 예전엔 이거 말고 "한 줄에 한 문장씩" 짧은 narrative도 종합보고서 위에 따로 보여줬는데, 사용자
 * 요청으로 그 필드·화면 노출을 전부 없애고 이 종합보고서 하나만 남겼다(2026-08-09).
 *
 * 일간판과 다른 점: riskyNews·step5BigTech·step7Institutional처럼 "그날의 개별 사건·종목" 데이터가
 * 기간 집계엔 없다(aggregateFromDaily가 점수만 평균내지 원본 사건을 보존하지 않음) — 그래서 ①·③
 * 문단은 개별 뉴스·종목명 대신 거부권 발동 비율·사분면 분포·충족 섹터 빈도처럼 집계 JSON에 실제
 * 있는 재료로만 쓰게 지시한다(없는 사건을 지어내지 말라는 원칙은 일간과 동일하게 유지).
 * 최종 점수는 일간과 같은 이유(LLM이 숫자를 옮겨적다 오기하는 사례가 실제 있었음)로
 * {{AVG_SCORE}} 플레이스홀더로 치환한다.
 */
function buildPeriodComprehensiveReportPrompt(summary: Awaited<ReturnType<typeof aggregatePeriod>>): string {
  const promptJson = {
    ...summary,
    metricChangesPct: relabelMetrics(summary.metricChangesPct),
    metricPointChangesBp: relabelMetrics(summary.metricPointChangesBp),
  };
  return `너는 매크로 자본흐름을 직접 챙겨보는 개인 투자자이고, 지금부터 쓰는 글은 자기 자신에게
존댓말로 보고하는 ${PERIOD_LABEL[summary.periodType]} 종합보고서다(반말로 쓰는 사적인 일기가
아니다). 아래는 ${summary.start} ~ ${summary.end} 기간 동안 집계된 체크리스트 결과(JSON)다. 이
결과만 근거로 이 기간 전체를 정리해라.

*** 문체 규칙(가장 중요, 다른 모든 규칙보다 우선) ***
출력하는 모든 문장은 예외 없이 "~습니다/~입니다/~합니다/~했습니다/~겠습니다" 같은 존댓말(합니다체)
로 끝나야 한다. "~다/~였다/~한다/~하다/~겠다"처럼 "다"로 끝나는 평서체 문장은 단 하나도 섞이면
안 된다. 문장은 자연스럽게 이어 쓰고 마침표마다 줄바꿈하지 마라 — 문단 단위로 흐르게 써라(한
줄에 한 문장씩 쓰는 짧은 요약과는 다른 글이니 특히 주의해라). 정해진 소제목이나 고정된 문단
분량을 강요하지 마라 — 특별할 게 없는 부분은 짧게 넘어가고 눈에 띄는 부분에 분량을 더 써라.

원칙
- 집계 JSON에 없는 숫자나 사실을 지어내지 마라. 데이터가 있는 날이 적으면 그 사실을 먼저 밝혀라.
- 기간 평균 점수(숫자)를 언급할 때는 절대 네가 직접 숫자를 옮겨 적지 마라 — 반드시 {{AVG_SCORE}}
  라는 문자열 그대로 써라(예: "이 기간 평균 점수는 {{AVG_SCORE}}점으로").
- 독자는 주식·경제를 전혀 모르는 일반인이라고 가정해라. "역레포", "크레딧 스프레드", "사분면",
  "텀프리미엄" 같은 용어가 나오면 처음 등장할 때 짧게 뜻과 왜 중요한지를 풀어써라. 분석의 깊이와
  정확성은 절대 낮추지 마라.
- 하루치 사건이 아니라 "이 기간 전체의 흐름"을 써라 — 기간 시작 점수에서 끝 점수로 어떻게
  달라졌는지, 결론이 며칠씩 어떻게 나뉘었는지가 핵심이다.
- 본문 어디에도 "1단계", "2단계"처럼 단계 번호를 쓰지 말고 "유동성", "캐리 트레이드"처럼 내용으로
  불러라.
- 크레딧 스프레드·실질금리·미국/일본 10년물·VIX는 metricPointChangesBp의 bp(또는 포인트) 값으로
  말해라 — metricChangesPct의 %는 이 5개 지표엔 쓰지 마라(3bp 움직임이 "+1.07%"로 보여 실제보다
  훨씬 크게 움직인 것처럼 오해하게 만든다). 나머지 지표는 %를 써도 된다.

다뤄야 할 내용 — 아래 다섯 덩어리를 이 순서대로, 각각 문단 하나씩 써라(원인 → 환경 → 이동 →
전망 → 판단 순서다). 소제목은 달지 마라(문단 흐름으로만 구분한다).

① 이 기간 자본을 움직인 가장 큰 요인은 무엇이었는가
   거부권이 발동된 날(vetoDays)이 기간의 절반을 넘으면 그 자체가 이 기간의 성격이다 — 며칠 중
   며칠이었는지 구체적으로 밝혀라. 엔화 변동성 급등(jpySpikeDays)이 감지된 날이 있으면 반드시
   짚어라. 개별 뉴스 사건명은 이 집계에 없으니 지어내지 마라 — 대신 위 두 지표로 "이 기간이
   왜 그런 성격이었는지"를 설명해라.

② 이 기간이 자산 가격을 들어올리기 좋은 환경이었는가
   avgStepScores.liquidity(유동성 평균 점수)와 유동성 관련 지표(연준 대차대조표·역레포·재무부
   일반계정·크레딧 스프레드·실질금리) 변화를 근거로 판정해라. avgStepScores.carry(캐리 트레이드
   평균 점수)도 함께 다뤄라 — 이것도 자산을 떠받치는 자금원이기 때문이다.

③ 자본이 실제로 어디로 갔는가
   지수별 변화율(S&P500·나스닥100·러셀2000·다우존스)과 금·달러·비트코인의 방향,
   topSectors(이 기간 가장 자주 조건을 충족한 섹터)를 종합해 지목해라. quadrantCounts(금값·
   실질금리 방향 조합 사분면)가 한쪽으로 쏠렸으면 그 국면이 기간 내내 지속됐는지도 짚어라. ②의
   환경 판정과 ③의 실제 이동이 어긋나면 반드시 짚어라 — 환경은 나쁜데 자금은 들어왔거나, 환경은
   좋은데 안 들어왔다면 그게 이 기간 가장 중요한 관찰이다. 개별 종목명·기관 매수 내역도 이
   집계엔 없으니 지어내지 마라.

④ 다음 기간에 자본이 어디로 갈 가능성이 있는가
   *** 집계에 있는 추세로만 조건문으로 써라. 그 밖의 예측은 절대 하지 마라. *** firstScore에서
   lastScore로 점수가 어느 방향으로 움직였는지가 사실상 유일한 추세 재료다. 단정하지 마라 —
   재료가 얇으면 "지금 데이터로는 방향을 좁히기 어렵습니다"라고 쓰는 게 지어내는 것보다 낫다.

⑤ 그래서 이 기간을 통틀어 주식시장에 들어가기 좋았는가, 그리고 지금은 어떤가
   이 기간 평균 점수는 {{AVG_SCORE}}점이다. decisionCounts(결론이 며칠씩 어떻게 나뉘었는지)를
   근거로 담백하게 정리해라. 평균 점수를 가장 크게 끌어올리거나 끌어내린 요인 한두 가지만 짚고,
   마지막은 이 기간 상황에 맞는 구체적인 대응 한 문장으로 끝내라 — 매번 같은 문장으로 마무리하지
   마라.

(위 번호와 "①·②" 같은 표기는 순서를 놓치지 않게 하려고 적어둔 것일 뿐, 실제 글에는 절대 그대로
옮기지 마라.)

마지막으로 다시 한번: 모든 문장을 "~습니다/~입니다"로 끝내고, 문단체로 자연스럽게 흐르게 써라.

집계 JSON:
${JSON.stringify(promptJson, null, 2)}`;
}

export async function generatePeriodComprehensiveReport(summary: Awaited<ReturnType<typeof aggregatePeriod>>): Promise<string> {
  let text = await generateNarrative(buildPeriodComprehensiveReportPrompt(summary), COMPREHENSIVE_MAX_OUTPUT_TOKENS);

  // 일간판(comprehensive-report.ts)과 같은 이유로 플레이스홀더 치환 — 직접 옮겨 적게 하면 오기
  // 가능성이 있고 잡을 방법이 없다.
  if (summary.avgMacroTrendScore !== null) {
    if (text.includes("{{AVG_SCORE}}")) {
      text = text.replaceAll("{{AVG_SCORE}}", summary.avgMacroTrendScore.toFixed(2));
    } else {
      console.error("generatePeriodComprehensiveReport: LLM이 {{AVG_SCORE}} 플레이스홀더를 안 지켰다 — 사실 오기 가능성, 원문 확인 필요");
    }
  }

  return collapseRepeatedDots(text);
}

export async function generateAndSavePeriodReport(type: PeriodType, reportDate: Date) {
  const summary = await aggregatePeriod(type, reportDate);

  let comprehensiveReport: string;
  try {
    comprehensiveReport = await generatePeriodComprehensiveReport(summary);
  } catch (err) {
    comprehensiveReport = `[종합보고서 생성 실패: ${err instanceof Error ? err.message : String(err)}]`;
  }

  const { start, end } = getPrecedingPeriodBounds(type, reportDate);
  await db.periodReport.upsert({
    where: { periodType_periodStart: { periodType: type, periodStart: start } },
    create: {
      periodType: type, periodStart: start, periodEnd: end,
      summary: summary as unknown as Prisma.InputJsonValue, comprehensiveReport,
    },
    update: { periodEnd: end, summary: summary as unknown as Prisma.InputJsonValue, comprehensiveReport },
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
