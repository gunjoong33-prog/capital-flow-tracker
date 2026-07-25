import { getLatestMetric, getMetricHistory, getMetricHistoryByCount, calculatePercentile, calculateCumulativeReturn } from "@/lib/metrics";
import { getRecentRiskyNews } from "@/lib/news-events";
import { getUpcomingMajorEvents } from "@/lib/major-events";
import { evaluateRecentEventOutcomes } from "@/lib/event-outcomes";
import { METRICS, SECTOR_ETFS } from "@/lib/sources/types";
import {
  scoreStep1,
  scoreStep2,
  scoreStep3,
  scoreStep4,
  scoreStep5,
  scoreStep6,
  scoreStep7,
  scoreStep8,
} from "./pure";
import type { Direction, SectorInput, StepDetailRow, StepDetails } from "./types";

/**
 * 하이일드(BAMLH0A0HYM2) 스프레드의 절대 수준 구간 — 월가 애널리스트들이 FRED로 신용위험을 읽을 때
 * 쓰는 임계점 그대로(3단계 캐리 트레이드 구간표와 같은 방식으로 추가). "3기간 연속 축소" 추세와는
 * 별개로, "지금 수준 자체가 위험한 구간인가"를 보여주는 보조 정보다.
 */
function creditSpreadZone(bp: number): string {
  if (bp < 300) return "과도한 낙관, 반등 리스크 경계";
  if (bp < 400) return "낙관에서 정상으로 이행";
  if (bp <= 500) return "역사적 평균 정상 구간";
  if (bp < 600) return "정상에서 경색으로 이행, 주의";
  return "신용경색·침체 경고";
}

/**
 * 값 뒤에 단위를 붙인다. 돈의 단위(백만달러·십억달러 등)는 괄호로 감싸 숫자와 헷갈리지 않게 하고,
 * %·bp는 관용적으로 숫자에 바로 붙여 쓰는 표기라 괄호 없이 직접 붙인다.
 */
/** 천단위 콤마만 넣는 축약형 — fmt()를 쓰기 애매한 문장 조립 내부용. */
function comma(v: number, decimals = 0): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmt(v: number | null, decimals = 2, unit = ""): string {
  if (v === null || Number.isNaN(v)) return "확인 못함";
  // 돈 단위 큰 숫자는 천단위 콤마를 넣어야 자릿수를 한눈에 읽는다(6747378 -> 6,747,378).
  // %·bp는 값 자체가 작아 콤마가 필요 없으니 그대로 둔다.
  const formatted = unit === "%" || unit === "bp"
    ? v.toFixed(decimals)
    : v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (!unit) return formatted;
  if (unit === "%" || unit === "bp") return `${formatted}${unit}`;
  return `${formatted} (${unit})`;
}

/**
 * 2단계 지표 7개(+보조 지표) 판정 결과를 결정론적 규칙으로 1~3줄 한국어 문장으로 요약한다.
 * LLM 호출 없이 이미 계산된 값만 조합하므로 재현 가능하고, "상세 보기" 토글을 안 열어도
 * 한눈에 상황을 파악할 수 있게 하는 게 목적이다.
 */
function summarizeStep2(
  step2Result: { overseasQualifyingCount: number; overseasTotalCount: number; finalScore: number },
  creditSpreadBp: number | null,
  netLiqRising: boolean | null,
  rrpDepleted: boolean | null,
  tgaWithinNormalRange: boolean | null
): string {
  const { overseasQualifyingCount: q, overseasTotalCount: t, finalScore } = step2Result;
  const ratio = t > 0 ? q / t : 0;
  const stance = ratio >= 5 / 7
    ? "뚜렷한 완화 국면"
    : ratio >= 3 / 7
      ? "신호가 엇갈리는 혼조 국면"
      : "대체로 위축된 국면";
  const lines = [`해외 유동성 지표 ${q}/${t}개가 우호적 방향으로, 자본 흐름은 ${stance}입니다(2단계 점수 ${finalScore.toFixed(1)}/10).`];

  if (creditSpreadBp !== null) {
    lines.push(`크레딧 스프레드는 ${creditSpreadBp.toFixed(0)}bp로 "${creditSpreadZone(creditSpreadBp)}" 구간입니다.`);
  }

  const auxParts: string[] = [];
  if (netLiqRising !== null) auxParts.push(`순유동성은 ${netLiqRising ? "상승" : "하락"} 추세`);
  if (rrpDepleted !== null) auxParts.push(`RRP 방파제는 ${rrpDepleted ? "고갈 경고" : "정상"}`);
  if (tgaWithinNormalRange !== null) auxParts.push(`TGA는 평균 대비 ${tgaWithinNormalRange ? "정상 범위" : "이탈"}`);
  if (auxParts.length > 0) lines.push(`${auxParts.join(", ")}입니다.`);

  return lines.join("\n");
}

/**
 * 3단계(캐리 트레이드) 지표 판정 결과를 1~3줄로 요약. summarizeStep2와 같은 원칙(결정론적, LLM 미사용).
 */
function summarizeStep3(
  step3Result: { spreadBp: number; zone: string },
  spreadPercentile: number | null,
  cftcPercentile: number | null,
  jpySpike: { spike: boolean; zScore: number | null }
): string {
  const zoneDesc = step3Result.zone === "안정" ? "유지되기 쉬운" : step3Result.zone === "주의" ? "주의가 필요한" : "위태로운";
  const lines = [`US10Y-JP10Y 스프레드가 ${step3Result.spreadBp}bp로 "${step3Result.zone}" 구간에 있어 엔 캐리 트레이드가 ${zoneDesc} 환경입니다.`];

  if (spreadPercentile !== null && cftcPercentile !== null) {
    const activity = cftcPercentile < 50 ? "활발한" : "저조한";
    lines.push(`최근 1년 스프레드 백분위는 ${spreadPercentile}%ile, CFTC 엔화 순포지션은 ${cftcPercentile}%ile로 캐리 트레이드가 ${activity} 편입니다.`);
  }

  if (jpySpike.zScore !== null) {
    lines.push(
      jpySpike.spike
        ? `엔화 변동성이 급등(z=${jpySpike.zScore})해 청산 압박이 커지고 있어 레버리지 축소가 필요합니다.`
        : `엔화 변동성 급등은 감지되지 않아(z=${jpySpike.zScore}) 아직 안정적입니다.`
    );
  }

  return lines.join("\n");
}

interface TrendCheck {
  met: boolean | null;
  latestValue: number | null;
}

/**
 * 최근 값들이 계속 늘고 있는지 판정 + 최신값 동시 반환. 데이터 부족하면 met=null(모름).
 * 날짜창이 아니라 "최근 N개 데이터포인트"로 가져온다 — 월간 지표(TOTRESNS, REAL_RATE 등)는
 * 발표가 몇 달씩 밀리기도 해서 날짜창 방식으론 필요한 개수를 못 채우는 경우가 있었다.
 */
async function risingCheck(metric: string, periods: number): Promise<TrendCheck> {
  const history = await getMetricHistoryByCount(metric, periods + 1);
  const latestValue = history.length > 0 ? history[history.length - 1].value : null;
  if (history.length < periods + 1) return { met: null, latestValue };
  let met = true;
  for (let i = 1; i < history.length; i++) {
    if (history[i].value <= history[i - 1].value) { met = false; break; }
  }
  return { met, latestValue };
}

async function fallingCheck(metric: string, periods: number): Promise<TrendCheck> {
  const history = await getMetricHistoryByCount(metric, periods + 1);
  const latestValue = history.length > 0 ? history[history.length - 1].value : null;
  if (history.length < periods + 1) return { met: null, latestValue };
  let met = true;
  for (let i = 1; i < history.length; i++) {
    if (history[i].value >= history[i - 1].value) { met = false; break; }
  }
  return { met, latestValue };
}

/**
 * M2의 원본 기준은 "값 자체가 늘었는가"가 아니라 "전년 동월 대비(YoY) 증가율이 2개월 연속 상향"이다 —
 * 즉 성장 자체가 아니라 성장 속도가 가속되는지를 본다(노션 v2 프롬프트 원문 그대로).
 * YoY(이번달) > YoY(지난달) > YoY(지지난달)이면 충족.
 */
async function m2YoyAcceleration(): Promise<TrendCheck & { detail: string }> {
  const history = await getMetricHistoryByCount(METRICS.M2, 20); // 3개월치 YoY 계산에 최소 15개월 필요, 여유 있게 20개
  const latestValue = history.length > 0 ? history[history.length - 1].value : null;
  const n = history.length;
  if (n < 15) return { met: null, latestValue, detail: "데이터 부족" };

  const yoy: number[] = [];
  for (let offset = 2; offset >= 0; offset--) {
    const idx = n - 1 - offset;
    const idxPrevYear = idx - 12;
    if (idxPrevYear < 0) return { met: null, latestValue, detail: "데이터 부족(12개월 전 값 필요)" };
    const curr = history[idx].value;
    const prevYear = history[idxPrevYear].value;
    yoy.push(((curr - prevYear) / prevYear) * 100);
  }
  const met = yoy[2] > yoy[1] && yoy[1] > yoy[0];
  return { met, latestValue, detail: `YoY 증가율 ${yoy.map((v) => `${v.toFixed(2)}%`).join(" → ")}` };
}

/**
 * 월가 순유동성(Net Liquidity) = 연준 총자산(WALCL) - TGA - RRP.
 * TGA·RRP는 연준 대차대조표상 부채 항목이라 이게 줄면 그만큼 시중 은행 지급준비금(실제 유동성)이
 * 늘어난다는 회계 항등식에 기반한다. 원본 프롬프트의 "지표 하나씩 개별 판정" 구조를 유지하려고
 * 해외 지표 7개 집계엔 넣지 않고 참고용 보조 지표로만 보여준다 — 방향성(상승/하락) 확인용.
 * 세 시리즈 모두 이미 수집돼있는 데이터라 별도 백필 없이 계산만 하면 된다.
 */
async function netLiquidityTrend(): Promise<{ detail: string; risingTrend: boolean | null }> {
  const [walcl, tga, rrp] = await Promise.all([
    getMetricHistoryByCount(METRICS.WALCL, 5),
    getMetricHistoryByCount(METRICS.TGA, 5),
    getMetricHistoryByCount(METRICS.RRP, 5),
  ]);
  if (walcl.length === 0 || tga.length === 0 || rrp.length === 0) {
    return { detail: "데이터 부족", risingTrend: null };
  }
  const netAt = (w: number, t: number, r: number) => w / 1000 - t / 1000 - r; // 전부 십억달러로 환산
  const current = netAt(walcl[walcl.length - 1].value, tga[tga.length - 1].value, rrp[rrp.length - 1].value);

  if (walcl.length < 5 || tga.length < 5 || rrp.length < 5) {
    return { detail: `${comma(current)} (십억달러)`, risingTrend: null };
  }
  const past = netAt(walcl[0].value, tga[0].value, rrp[0].value);
  const change = current - past;
  return {
    detail: `${comma(current)} (십억달러) — 4기간 전 대비 ${change >= 0 ? "+" : ""}${comma(change)} (십억달러)`,
    risingTrend: change > 0,
  };
}

/** RRP가 2023년 고점(~2.5조 달러) 대비 사실상 바닥났는지 — 고갈되면 연준 QT 충격을 흡수해줄 방파제가 사라진다. */
function rrpBufferStatus(rrpBillions: number): { depleted: boolean; label: string } {
  if (rrpBillions < 50) return { depleted: true, label: "고갈(방파제 소진) — QT·국채발행이 지준을 직접 흡수할 위험" };
  if (rrpBillions < 200) return { depleted: false, label: "저수위, 방파제 여력 얼마 안 남음" };
  return { depleted: false, label: "방파제 여력 있음" };
}

/**
 * 재무부의 실제 QRA 목표잔액은 분기별 발표문에만 있어 구조화된 데이터로 가져올 수 없다 —
 * 대신 최근 8기간 평균을 "최근 정상 범위"로 삼아 이탈도를 본다(공식 목표치의 근사치).
 */
async function tgaDeviationFromRecentAverage(): Promise<{ detail: string; withinNormalRange: boolean | null }> {
  const history = await getMetricHistoryByCount(METRICS.TGA, 9);
  if (history.length < 9) return { detail: "데이터 부족", withinNormalRange: null };
  const current = history[history.length - 1].value;
  const baseline = history.slice(0, 8).reduce((a, b) => a + b.value, 0) / 8;
  const deviationPct = ((current - baseline) / baseline) * 100;
  return {
    detail: `${comma(current / 1000)} (십억달러) — 최근 8기간 평균 ${comma(baseline / 1000)} (십억달러) 대비 ${deviationPct >= 0 ? "+" : ""}${deviationPct.toFixed(1)}%`,
    withinNormalRange: Math.abs(deviationPct) < 10,
  };
}

async function directionOf(metric: string): Promise<Direction | null> {
  // 날짜창(예: 최근 10일) 방식은 월간 지표(REAL_RATE 등)가 발표 지연 시 데이터 0~1개만 잡혀
  // 늘 null->"flat"로 새는 버그가 있었다 — "최근 2개 데이터포인트"로 바꿔 발표 주기와 무관하게 동작.
  const [prev, curr] = await getMetricHistoryByCount(metric, 2);
  if (!prev || !curr) return null;
  if (curr.value > prev.value) return "up";
  if (curr.value < prev.value) return "down";
  return "flat";
}

/**
 * USD/JPY 일간 변동률을 최근 19개 변동률의 평균·표준편차와 비교(z-score).
 * |z| > 2 이거나 하루 변동률이 1.5%를 넘으면 "급등"으로 본다 — 표준편차가 아주 작을 때도
 * 절대 임계값으로 걸러지도록 두 조건을 OR로 묶었다. 데이터가 21개 미만이면 판정 보류(급등 아님).
 */
async function detectJpyVolSpike(): Promise<{ spike: boolean; zScore: number | null; latestReturnPct: number | null }> {
  const history = await getMetricHistory(METRICS.USDJPY, 60);
  if (history.length < 21) return { spike: false, zScore: null, latestReturnPct: null };
  const recent = history.slice(-21);
  const returns: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    returns.push((recent[i].value - recent[i - 1].value) / recent[i - 1].value);
  }
  const latestReturn = returns[returns.length - 1];
  const baseline = returns.slice(0, -1);
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance = baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length;
  const std = Math.sqrt(variance);
  const z = std > 0 ? (latestReturn - mean) / std : 0;
  const spike = Math.abs(z) > 2 || Math.abs(latestReturn) > 0.015;
  return { spike, zScore: Number(z.toFixed(2)), latestReturnPct: Number((latestReturn * 100).toFixed(2)) };
}

/**
 * 오늘자 v2 체크리스트 전체를 DB 데이터로 계산한다.
 * 지표가 없으면 해당 판정은 null(모름)로 남기고 억지로 채우지 않는다 —
 * 원칙: "확인 못하면 확인 못함이라고 쓴다"(v2 프롬프트 핵심 원칙).
 *
 * 뉴스 판정(1단계)은 매일 파이프라인이 미리 수집·Gemini 판정해 NewsEvent에 저장해둔 것을 읽기만 한다 —
 * 여기서 다시 뉴스를 가져와 판정하면 페이지를 열 때마다 LLM을 호출하게 되므로 분리했다.
 * FOMC·CPI·고용지표 등 "14일 내 큰 이벤트"도 마찬가지로 MajorEvent 테이블을 읽기만 한다.
 * 엔화 변동성 급등은 이미 저장된 USD/JPY 시계열로 그때그때 계산한다(DB 조회만 필요, 비용 없음).
 *
 * CNN 공포탐욕지수(공식 API 없음)와 섹터 5일 수익률(수동/외부 조회)만 여전히 별도 인자로 받는다.
 *
 * details: 각 단계 판정에 쓰인 실제 기준·수치를 UI 표로 보여주기 위한 행 데이터.
 * 점수 계산과 별개 경로로 채워서, 표시용 가공이 점수 로직에 영향을 주지 않게 분리했다.
 */
export async function runDailyAnalysis(manualInputs: {
  domesticWeightHigh: boolean;
  fearGreed: number | null;
  sectors: SectorInput[];
}) {
  const details = {} as StepDetails;

  // 1단계 — 거부권은 "뉴스 3건 이상" 또는 "최근 발표된 FOMC/CPI/고용지표 결과가 서프라이즈"일 때 발동.
  // (예정된 이벤트가 있다는 것만으로 발동하면 FOMC·CPI·고용지표를 합쳐 거의 매일 걸려서 거부권이 상시 발동해버림 —
  // 그래서 "예정" 여부가 아니라 "지난 발표의 실제 결과"로 기준을 바꿨다. 예정 목록은 정보용으로만 따로 보여준다.)
  const riskyNews = await getRecentRiskyNews(7);
  const upcomingEvents = await getUpcomingMajorEvents(14);
  const recentOutcomes = await evaluateRecentEventOutcomes(5);
  const hasEventSurprise = recentOutcomes.some((o) => o.risky);
  const step1 = {
    ...scoreStep1({
      newsCountLast7Days: riskyNews.length,
      hasRecentEventSurprise: hasEventSurprise,
    }),
    riskyNews: riskyNews.map((n) => ({ title: n.title, url: n.url, summary: n.summary, date: n.date.toISOString().slice(0, 10) })),
    upcomingEvents: upcomingEvents.map((e) => ({ name: e.name, date: e.date.toISOString().slice(0, 10) })),
    recentEventOutcomes: recentOutcomes,
  };
  details.step1 = [
    {
      label: "최근 7일 시장을 흔든 뉴스",
      criterion: "3건 미만",
      value: `${riskyNews.length}건`,
      met: riskyNews.length < 3,
    },
    ...recentOutcomes.map((o) => ({
      label: `${o.name}(${o.date}) 실제 결과`,
      criterion: "예상 범위 내(서프라이즈 아님)",
      value: o.detail,
      met: !o.risky,
    })),
    {
      label: "14일 내 예정된 이벤트",
      criterion: "-",
      value: upcomingEvents.length > 0
        ? upcomingEvents.map((e) => `${e.name}(${e.date.toISOString().slice(0, 10)})`).join(", ")
        : "없음",
      met: null,
    },
  ];

  // 2단계
  const walcl = await risingCheck(METRICS.WALCL, 2);
  const m2 = await m2YoyAcceleration();
  const reserves = await risingCheck(METRICS.TOTRESNS, 4);
  const rrp = await fallingCheck(METRICS.RRP, 3);
  const tga = await fallingCheck(METRICS.TGA, 3);
  const realRate2 = await fallingCheck(METRICS.REAL_RATE, 3);
  const creditSpread = await fallingCheck(METRICS.CREDIT_SPREAD, 3);
  const kospiForeign = await risingCheck(METRICS.KOSPI_FOREIGN_NET, 5);

  const step2 = scoreStep2({
    walclIncreasing: walcl.met,
    m2GrowthRising2Months: m2.met,
    reservesRising4Weeks: reserves.met,
    rrpDeclining: rrp.met,
    tgaDeclining: tga.met,
    realRateFallingOrLowFlat: realRate2.met,
    creditSpreadNarrowing: creditSpread.met,
    domesticWeightHigh: manualInputs.domesticWeightHigh,
    bokRateEasing: null, // 한국은행 기준금리는 비정기 발표 — 별도 로직 필요, 1차 구현에선 미판정
    cpiNearTarget: null,
    kospiForeignNetBuying: kospiForeign.met,
  });
  details.step2 = [
    { label: "Fed 대차대조표(WALCL)", criterion: "최근 2기간 연속 증가", value: fmt(walcl.latestValue, 0, "백만달러"), met: walcl.met },
    { label: "M2 통화량", criterion: "YoY 증가율 2개월 연속 상향(가속)", value: m2.detail, met: m2.met },
    { label: "기준잔액(WRESBAL)", criterion: "최근 4주 연속 증가", value: fmt(reserves.latestValue, 0, "백만달러"), met: reserves.met },
    { label: "RRP(역레포 잔액)", criterion: "최근 3기간 연속 감소", value: fmt(rrp.latestValue, 2, "십억달러"), met: rrp.met },
    { label: "TGA(재무부 일반계정)", criterion: "최근 3기간 연속 감소", value: fmt(tga.latestValue, 0, "백만달러"), met: tga.met },
    { label: "실질금리(10년)", criterion: "최근 3기간 연속 하락(또는 낮은 데서 횡보)", value: fmt(realRate2.latestValue, 2, "%"), met: realRate2.met },
    {
      label: "크레딧 스프레드(하이일드 OAS)",
      criterion: "최근 3기간 연속 축소",
      value: creditSpread.latestValue !== null
        ? `${(creditSpread.latestValue * 100).toFixed(0)}bp — ${creditSpreadZone(creditSpread.latestValue * 100)}`
        : "확인 못함",
      met: creditSpread.met,
    },
  ];

  // 보조 지표 4개 — 원본 프롬프트의 7개 지표 구조를 그대로 유지하려고 해외 지표 집계엔 안 넣고
  // "분석 기준·지표 상세 보기"와는 별도 토글("보조 지표 보기")로 뺀다.
  details.step2Aux = [];

  // BBB 등급 스프레드: 200bp 넘으면 우량 기업조차 차환에 어려움을 겪는다는 신호.
  const bbb = await getLatestMetric(METRICS.CREDIT_SPREAD_BBB);
  const bbbBp = bbb ? bbb.value * 100 : null;
  details.step2Aux.push({
    label: "BBB 등급 스프레드",
    criterion: "200bp 초과 시 우량기업 차환 어려움 경고",
    value: bbbBp !== null ? `${bbbBp.toFixed(0)}bp` : "확인 못함",
    met: bbbBp !== null ? bbbBp <= 200 : null,
  });

  // 월가 순유동성 프레임워크(WALCL-TGA-RRP) 기반 보조 지표 3개.
  const netLiq = await netLiquidityTrend();
  details.step2Aux.push({
    label: "순유동성 Net Liquidity",
    criterion: "연준 총자산-TGA-RRP. 상승하면 증시에 우호적(월가 프레임워크)",
    value: netLiq.detail,
    met: netLiq.risingTrend,
  });

  let rrpDepleted: boolean | null = null;
  if (rrp.latestValue !== null) {
    const rrpStatus = rrpBufferStatus(rrp.latestValue);
    rrpDepleted = rrpStatus.depleted;
    details.step2Aux.push({
      label: "RRP 방파제 상태",
      criterion: "50십억달러 미만이면 방파제 고갈 경고",
      value: `${fmt(rrp.latestValue, 2, "십억달러")} — ${rrpStatus.label}`,
      met: !rrpStatus.depleted,
    });
  }

  const tgaDeviation = await tgaDeviationFromRecentAverage();
  details.step2Aux.push({
    label: "TGA 최근 평균 대비 이탈도",
    criterion: "최근 8기간 평균 대비 ±10%p 이탈 시 경계(공식 QRA 목표치 근사)",
    value: tgaDeviation.detail,
    met: tgaDeviation.withinNormalRange,
  });

  details.step2Summary = summarizeStep2(
    step2,
    creditSpread.latestValue !== null ? creditSpread.latestValue * 100 : null,
    netLiq.risingTrend,
    rrpDepleted,
    tgaDeviation.withinNormalRange
  );

  if (manualInputs.domesticWeightHigh) {
    details.step2.push(
      { label: "한국은행 기준금리 인하", criterion: "비정기 발표 — 자동 미판정", value: "확인 못함", met: null },
      { label: "국내 CPI 목표치(2%) 근접", criterion: "자동 미판정", value: "확인 못함", met: null },
      { label: "코스피 외국인 순매수", criterion: "최근 5거래일 연속 순매수", value: fmt(kospiForeign.latestValue, 0), met: kospiForeign.met },
    );
  }

  // 3단계
  const us10y = await getLatestMetric(METRICS.US10Y);
  const jp10y = await getLatestMetric(METRICS.JP10Y);
  const spreadPercentile = us10y && jp10y
    ? await calculatePercentile(METRICS.US10Y_2Y10Y_SPREAD, (us10y.value - jp10y.value) * 100)
    : null;
  const cftcLatest = await getLatestMetric(METRICS.CFTC_JPY_NET);
  const cftcPercentile = cftcLatest ? await calculatePercentile(METRICS.CFTC_JPY_NET, cftcLatest.value) : null;
  const jpySpike = await detectJpyVolSpike();
  const step3 = scoreStep3({
    us10y: us10y?.value ?? 0,
    jp10y: jp10y?.value ?? 0,
    spreadBpPercentile: spreadPercentile,
    cftcNetPositionPercentile: cftcPercentile,
    jpyVolSpike: jpySpike.spike,
  });
  details.step3 = [
    { label: "미국 10년물(US10Y)", criterion: "참고용", value: fmt(us10y?.value ?? null, 2, "%"), met: null },
    { label: "일본 10년물(JP10Y)", criterion: "참고용", value: fmt(jp10y?.value ?? null, 2, "%"), met: null },
    { label: "US10Y-JP10Y 스프레드", criterion: "≥350bp 안정 / 250~349bp 주의 / <250bp 위험(미검증 참고 구간)", value: `${step3.spreadBp}bp — ${step3.zone}`, met: step3.zone === "안정" },
    { label: "스프레드 최근 1년 백분위", criterion: "50%ile 이상(중앙값보다 넓음) 시 충족", value: spreadPercentile !== null ? `${spreadPercentile}%ile` : "데이터 부족(1년 미만)", met: spreadPercentile !== null ? spreadPercentile >= 50 : null },
    { label: "CFTC 엔화 순포지션 백분위", criterion: "50%ile 미만(숏 우위, 캐리 활발) 시 충족", value: cftcPercentile !== null ? `${cftcPercentile}%ile` : "데이터 부족(1년 미만)", met: cftcPercentile !== null ? cftcPercentile < 50 : null },
    {
      label: "엔화 변동성 급등(USD/JPY)",
      criterion: "일간 변동률이 최근 20일 평균 대비 2표준편차 초과 또는 1.5%p 초과",
      value: jpySpike.zScore !== null
        ? `${jpySpike.latestReturnPct}% (z=${jpySpike.zScore})`
        : "데이터 부족(21거래일 미만)",
      met: jpySpike.zScore !== null ? !jpySpike.spike : null,
    },
  ];

  details.step3Summary = summarizeStep3(step3, spreadPercentile, cftcPercentile, jpySpike);

  // 4단계
  const goldDir = (await directionOf(METRICS.GOLD)) ?? "flat";
  const realRateDir = (await directionOf(METRICS.REAL_RATE)) ?? "flat";
  const dollarDir = (await directionOf(METRICS.USDKRW)) ?? "flat";
  const step4 = scoreStep4({ goldDirection: goldDir, realRateDirection: realRateDir, dollarDirection: dollarDir });
  const dirLabel = (d: Direction) => (d === "up" ? "상승" : d === "down" ? "하락" : "보합");
  details.step4 = [
    { label: "금 가격 방향", criterion: "직전 대비", value: dirLabel(goldDir), met: null },
    { label: "실질금리 방향", criterion: "직전 대비", value: dirLabel(realRateDir), met: null },
    { label: "달러(USD/KRW) 방향(보조 확인)", criterion: "실질금리와 같은 방향이면 신호 강함", value: dirLabel(dollarDir), met: step4.dollarConfirms },
    { label: "사분면 판정", criterion: "금·실질금리 조합", value: step4.quadrant, met: null },
  ];

  // 5단계
  const ndxReturn20d = (await calculateCumulativeReturn(METRICS.NDX, 20)) ?? 0;
  const rutReturn20d = (await calculateCumulativeReturn(METRICS.RUT, 20)) ?? 0;
  const djiReturn20d = (await calculateCumulativeReturn(METRICS.DJI, 20)) ?? 0;
  const spxReturn20d = (await calculateCumulativeReturn(METRICS.SPX, 20)) ?? 0;
  const btcReturn20d = await calculateCumulativeReturn(METRICS.BTC, 20);
  const ethReturn20d = await calculateCumulativeReturn(METRICS.ETH, 20);
  const gapPercentile = await calculatePercentile("NDX_RUT_GAP", ndxReturn20d - rutReturn20d);
  const step5 = scoreStep5({
    ndxReturn20d, rutReturn20d, gapPercentile, djiReturn20d, spxReturn20d, btcReturn20d, ethReturn20d,
  });
  details.step5 = [
    { label: "나스닥100(NDX) 20거래일 누적수익률", criterion: "참고용", value: fmt(ndxReturn20d, 2, "%"), met: null },
    { label: "러셀2000(RUT) 20거래일 누적수익률", criterion: "참고용", value: fmt(rutReturn20d, 2, "%"), met: null },
    { label: "나스닥-러셀 격차", criterion: "3%p 초과 시 쏠림 경계", value: `${step5.gapPp.toFixed(2)}%p`, met: !step5.concentrationWarning },
    { label: "격차 최근 1년 백분위", criterion: "낮을수록(격차 작을수록) 고득점", value: gapPercentile !== null ? `${gapPercentile}%ile` : "데이터 부족(1년 미만)", met: null },
    { label: "다우존스(DJI) 20거래일 누적수익률", criterion: "SPX와 비교해 위험선호 판정", value: fmt(djiReturn20d, 2, "%"), met: null },
    { label: "S&P500(SPX) 20거래일 누적수익률", criterion: "DJI와 비교해 위험선호 판정", value: fmt(spxReturn20d, 2, "%"), met: null },
    { label: "비트코인 20거래일 누적수익률", criterion: "나스닥과 동조 여부 참고", value: fmt(btcReturn20d, 2, "%"), met: null },
    { label: "이더리움 20거래일 누적수익률", criterion: "참고용", value: fmt(ethReturn20d, 2, "%"), met: null },
  ];

  // 6단계
  const step6 = scoreStep6({ sectors: manualInputs.sectors });
  const qualifyingSet = new Set(step6.qualifying);
  details.step6 = manualInputs.sectors.length > 0
    ? manualInputs.sectors.map((s) => ({
        label: s.name,
        criterion: "5일 수익률 상위 3위 이내 + 거래량 20일 평균 대비 120%+",
        value: `${s.return5d.toFixed(2)}% / 거래량 ${s.volumeRatio.toFixed(2)}배`,
        met: qualifyingSet.has(s.name),
      }))
    : [{ label: "섹터 데이터", criterion: "-", value: "확인 못함", met: null }];

  // 7단계
  const vix = await getLatestMetric(METRICS.VIX);
  const step7 = scoreStep7({ vix: vix?.value ?? null, fearGreed: manualInputs.fearGreed });
  details.step7 = [
    { label: "VIX", criterion: "<15 과열 / >25 공포", value: fmt(vix?.value ?? null, 2), met: null },
    { label: "CNN 공포와 탐욕지수", criterion: ">75 과열 / <25 공포 (자동 미연동)", value: manualInputs.fearGreed !== null ? `${manualInputs.fearGreed}` : "확인 못함", met: null },
    { label: "양쪽 동시 과열", criterion: "매수 크기 30% 축소", value: step7.bothOverheated ? "예" : "아니오", met: !step7.bothOverheated },
    { label: "공포 구간", criterion: "역발상 매수 기회 고려", value: step7.fearZone ? "예" : "아니오", met: null },
  ];

  // 8단계
  const step8 = scoreStep8({ step1, step2, step3, step4, step5, step6, step7 });
  details.step8 = [
    { label: "2단계 유동성 (가중치 2.5)", criterion: "가중 반영", value: `${step2.finalScore.toFixed(2)} × 2.5 = ${(step2.finalScore * 2.5).toFixed(2)}`, met: null },
    { label: "3단계 캐리 트레이드 (가중치 2.0)", criterion: "가중 반영", value: `${step3.score.toFixed(2)} × 2 = ${(step3.score * 2).toFixed(2)}`, met: null },
    { label: "4단계 환율·금·유가 (가중치 1.5)", criterion: "가중 반영", value: `${step4.score.toFixed(2)} × 1.5 = ${(step4.score * 1.5).toFixed(2)}`, met: null },
    { label: "5단계 자금 도착 (가중치 1.5)", criterion: "가중 반영", value: `${step5.score.toFixed(2)} × 1.5 = ${(step5.score * 1.5).toFixed(2)}`, met: null },
    { label: "6단계 섹터 (가중치 0.5)", criterion: "가중 반영", value: `${step6.score.toFixed(2)} × 0.5 = ${(step6.score * 0.5).toFixed(2)}`, met: null },
    { label: "투자 적합도 점수", criterion: "가중합 / 8", value: step8.macroTrendScore.toFixed(3), met: null },
    { label: "1단계 거부권 적용", criterion: "발동 시 한 단계 하향", value: step8.vetoApplied ? "적용됨" : "미적용", met: !step8.vetoApplied },
    { label: "최종 결론", criterion: "≥7.0 매수 / ≥5.0 지켜보기 / 미만 현금비중늘리기", value: step8.finalDecision, met: null },
  ];

  return { step1, step2, step3, step4, step5, step6, step7, step8, details };
}

// 참고: SECTOR_ETFS는 6단계 수동 입력을 만들 때 어떤 티커를 조회해야 하는지 알려주는 상수.
// EODHD 연동(6번 과제) 완료 전까지는 sectors 배열을 호출부에서 직접 채워 넣어야 한다.
export { SECTOR_ETFS };
export type { StepDetailRow, StepDetails };
