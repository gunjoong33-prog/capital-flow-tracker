import { getLatestMetric, getMetricHistory, calculatePercentile, calculateCumulativeReturn } from "@/lib/metrics";
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

function fmt(v: number | null, decimals = 2, suffix = ""): string {
  if (v === null || Number.isNaN(v)) return "확인 못함";
  return `${v.toFixed(decimals)}${suffix}`;
}

interface TrendCheck {
  met: boolean | null;
  latestValue: number | null;
}

/** 최근 값들이 계속 늘고 있는지 판정 + 최신값 동시 반환. 데이터 부족하면 met=null(모름). */
async function risingCheck(metric: string, periods: number): Promise<TrendCheck> {
  const history = await getMetricHistory(metric, periods * 10);
  const latestValue = history.length > 0 ? history[history.length - 1].value : null;
  if (history.length < periods + 1) return { met: null, latestValue };
  const recent = history.slice(-(periods + 1));
  let met = true;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].value <= recent[i - 1].value) { met = false; break; }
  }
  return { met, latestValue };
}

async function fallingCheck(metric: string, periods: number): Promise<TrendCheck> {
  const history = await getMetricHistory(metric, periods * 10);
  const latestValue = history.length > 0 ? history[history.length - 1].value : null;
  if (history.length < periods + 1) return { met: null, latestValue };
  const recent = history.slice(-(periods + 1));
  let met = true;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].value >= recent[i - 1].value) { met = false; break; }
  }
  return { met, latestValue };
}

async function directionOf(metric: string): Promise<Direction | null> {
  const history = await getMetricHistory(metric, 10);
  if (history.length < 2) return null;
  const [prev, curr] = history.slice(-2);
  if (curr.value > prev.value) return "up";
  if (curr.value < prev.value) return "down";
  return "flat";
}

/**
 * 오늘자 v2 체크리스트 전체를 DB 데이터로 계산한다.
 * 지표가 없으면 해당 판정은 null(모름)로 남기고 억지로 채우지 않는다 —
 * 원칙: "확인 못하면 확인 못함이라고 쓴다"(v2 프롬프트 핵심 원칙).
 *
 * 수동 입력 지표(CNN F&G, 비트코인 ETF 자금흐름)와 finviz 대체 지표(섹터 5일 수익률)는
 * 별도 인자로 주입받는다 — 자동 수집원이 없기 때문(지난 감사 리스크1 참고).
 *
 * details: 각 단계 판정에 쓰인 실제 기준·수치를 UI 표로 보여주기 위한 행 데이터.
 * 점수 계산과 별개 경로로 채워서, 표시용 가공이 점수 로직에 영향을 주지 않게 분리했다.
 */
export async function runDailyAnalysis(manualInputs: {
  newsCountLast7Days: number;
  hasBigEventNext14Days: boolean;
  domesticWeightHigh: boolean;
  jpyVolSpike: boolean;
  fearGreed: number | null;
  sectors: SectorInput[];
}) {
  const details = {} as StepDetails;

  // 1단계
  const step1 = scoreStep1({
    newsCountLast7Days: manualInputs.newsCountLast7Days,
    hasBigEventNext14Days: manualInputs.hasBigEventNext14Days,
  });
  details.step1 = [
    {
      label: "최근 7일 시장을 흔든 뉴스",
      criterion: "3건 미만",
      value: `${manualInputs.newsCountLast7Days}건`,
      met: manualInputs.newsCountLast7Days < 3,
    },
    {
      label: "14일 내 큰 이벤트(FOMC 등)",
      criterion: "예정 없음",
      value: manualInputs.hasBigEventNext14Days ? "있음" : "없음",
      met: !manualInputs.hasBigEventNext14Days,
    },
  ];

  // 2단계
  const walcl = await risingCheck(METRICS.WALCL, 2);
  const m2 = await risingCheck(METRICS.M2, 2);
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
    { label: "Fed 자산(WALCL)", criterion: "최근 2기간 연속 증가", value: fmt(walcl.latestValue, 0), met: walcl.met },
    { label: "M2 통화량", criterion: "최근 2기간 연속 증가", value: fmt(m2.latestValue, 0), met: m2.met },
    { label: "지급준비금(TOTRESNS)", criterion: "최근 4주 연속 증가", value: fmt(reserves.latestValue, 0), met: reserves.met },
    { label: "역레포(RRP)", criterion: "최근 3기간 연속 감소", value: fmt(rrp.latestValue, 0), met: rrp.met },
    { label: "TGA(재무부 일반계정)", criterion: "최근 3기간 연속 감소", value: fmt(tga.latestValue, 0), met: tga.met },
    { label: "실질금리(10년)", criterion: "최근 3기간 연속 하락(또는 낮은 데서 횡보)", value: fmt(realRate2.latestValue, 2, "%"), met: realRate2.met },
    { label: "크레딧 스프레드", criterion: "최근 3기간 연속 축소", value: fmt(creditSpread.latestValue, 2), met: creditSpread.met },
  ];
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
  const step3 = scoreStep3({
    us10y: us10y?.value ?? 0,
    jp10y: jp10y?.value ?? 0,
    spreadBpPercentile: spreadPercentile,
    cftcNetPositionPercentile: cftcPercentile,
    jpyVolSpike: manualInputs.jpyVolSpike,
  });
  details.step3 = [
    { label: "미국 10년물(US10Y)", criterion: "참고용", value: fmt(us10y?.value ?? null, 2, "%"), met: null },
    { label: "일본 10년물(JP10Y)", criterion: "참고용", value: fmt(jp10y?.value ?? null, 2, "%"), met: null },
    { label: "US10Y-JP10Y 스프레드", criterion: "≥350bp 안정 / 250~349bp 주의 / <250bp 위험(미검증 참고 구간)", value: `${step3.spreadBp}bp (${step3.zone})`, met: null },
    { label: "스프레드 최근 1년 백분위", criterion: "높을수록 캐리 유리", value: spreadPercentile !== null ? `${spreadPercentile}%ile` : "데이터 부족(1년 미만)", met: null },
    { label: "CFTC 엔화 순포지션 백분위", criterion: "참고용(숏 깊이)", value: cftcPercentile !== null ? `${cftcPercentile}%ile` : "데이터 부족(1년 미만)", met: null },
    { label: "엔화(USD/JPY) 변동성 급등", criterion: "감지 시 청산 신호 최우선", value: manualInputs.jpyVolSpike ? "감지됨" : "없음", met: !manualInputs.jpyVolSpike },
  ];

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
    { label: "매크로 추세 점수", criterion: "가중합 / 8", value: step8.macroTrendScore.toFixed(3), met: null },
    { label: "1단계 거부권 적용", criterion: "발동 시 한 단계 하향", value: step8.vetoApplied ? "적용됨" : "미적용", met: !step8.vetoApplied },
    { label: "최종 결론", criterion: "≥7.0 매수 / ≥5.0 지켜보기 / 미만 현금비중늘리기", value: step8.finalDecision, met: null },
  ];

  return { step1, step2, step3, step4, step5, step6, step7, step8, details };
}

// 참고: SECTOR_ETFS는 6단계 수동 입력을 만들 때 어떤 티커를 조회해야 하는지 알려주는 상수.
// EODHD 연동(6번 과제) 완료 전까지는 sectors 배열을 호출부에서 직접 채워 넣어야 한다.
export { SECTOR_ETFS };
export type { StepDetailRow, StepDetails };
