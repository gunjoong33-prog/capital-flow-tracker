import { getLatestMetric, getMetricHistory, getMetricHistoryByCount, calculatePercentile, calculatePercentileByCount, calculateCumulativeReturn } from "@/lib/metrics";
import {
  getRecentRiskyNews,
  newsItemWeight,
  getNewsRiskScorePercentile,
  computeNewsRiskIntensity,
  SEVERE_NEWS_WINDOW_DAYS,
  SEVERE_NEWS_MAX_PRIORITY,
} from "@/lib/news-events";
import { getUpcomingMajorEvents } from "@/lib/major-events";
import { evaluateRecentEventOutcomes } from "@/lib/event-outcomes";
import { METRICS, SECTOR_ETFS, BIG_TECH_TICKERS, BIG_TECH_LABELS } from "@/lib/sources/types";
import type { InstitutionalSignals } from "@/lib/institutional-signals";
import {
  scoreStep1,
  scoreStep2,
  scoreStep3,
  scoreStep4,
  scoreStep5,
  scoreStep6,
  scoreStep7,
  scoreStep8,
  WEIGHTS,
  TOTAL_WEIGHT,
} from "./pure";
import type { Direction, SectorInput, Step5Result, StepDetailRow, StepDetails } from "./types";
import {
  NEWS_RISK_SCORE_THRESHOLD,
  VIX_OVERHEAT_BELOW,
  VIX_FEAR_ABOVE,
  FEAR_GREED_EXTREME_FEAR_BELOW,
  FEAR_GREED_EXTREME_GREED_ABOVE,
} from "./types";
import { buildPptSlides } from "./ppt-slides";
import { nbsp, slashDate } from "@/lib/text-format";
import { daysBetween } from "@/lib/date";

// 크레딧 스프레드가 "이미 과도한 낙관(=우호 충족) 구간"으로 넘어가는 경계값 — creditSpreadZone·
// scoreStep2 입력(creditSpreadAlreadyTight)·forwardSignals 문구까지 총 4곳에서 같은 300bp를
// 매직넘버로 반복 써서(코드 감사로 발견) 하나로 묶는다. 값 자체는 그대로, 이름만 붙였다.
const CREDIT_SPREAD_TIGHT_BP = 300;

// 7단계 "기관·내부자 매집" 표의 출처 링크 — 런타임 값에 의존하지 않는데도 함수 안에 선언돼 있었다
// (코드 감사로 발견). 모듈 상단 상수로 올린다.
const DATAROMA_URL = "https://www.dataroma.com/m/allact.php?typ=a";
const OPENINSIDER_URL = "http://openinsider.com/latest-insider-trading";
const FINRA_SHORT_VOLUME_URL = "https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files";
const KRX_SHORT_URL = "https://short.krx.co.kr";
const DART_EQUITY_URL = "https://opendart.fss.or.kr/disclosureinfo/qota/main.do";

// 2·3·4단계 상세표의 "바로가기" 출처 링크 — 7단계(위 4개 상수)와 같은 목적, FRED/Yahoo/MOF는
// 시리즈·티커별로 URL이 달라져서 상수 대신 헬퍼로 뺀다.
const FRED_URL = (seriesId: string) => `https://fred.stlouisfed.org/series/${seriesId}`;
const YAHOO_URL = (ticker: string) => `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`;
const MOF_JAPAN_URL = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/index.htm";
const CFTC_TFF_URL = "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm";

/**
 * 하이일드(BAMLH0A0HYM2) 스프레드의 절대 수준 구간 — 월가 애널리스트들이 FRED로 신용위험을 읽을 때
 * 쓰는 임계점 그대로(3단계 캐리 트레이드 구간표와 같은 방식으로 추가). "3기간 연속 축소" 추세와는
 * 별개로, "지금 수준 자체가 위험한 구간인가"를 보여주는 보조 정보다.
 */
// 300bp 미만 구간은 met=true(유동성 우호 충족)로 판정하면서 동시에 "반등 리스크 경계"라는 문구를
// 붙이는데, 화면상 ✓ 표시와 경고 문구가 한 줄에 같이 보이면 모순처럼 읽힌다(외부 감사 지적) — 실제
// 논리는 모순이 아니다: 스프레드가 이미 우호적 극단에 있다는 사실(met=true 근거)과, 그렇게 낮은
// 스프레드가 오래가지 못하고 되돌림(반등) 위험을 안고 있다는 사실(경계 문구)은 서로 다른 얘기다.
// 문구 자체를 "충족 근거 + 별도 경계"로 명확히 분리해 같은 오독이 반복되지 않게 한다.
function creditSpreadZone(bp: number): string {
  if (bp < CREDIT_SPREAD_TIGHT_BP) return "유동성 우호 구간(충족) — 단, 과도한 낙관 상태라 되돌림(반등) 리스크는 별도 경계";
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

/** 한글 명사 뒤에 "로/으로" 조사를 받침 유무에 맞게 붙인다(7단계 종합판단 등 문장 생성용). */
function attachRo(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}로`;
  const hasBatchim = (last - 0xac00) % 28 !== 0;
  return `${word}${hasBatchim ? "으로" : "로"}`;
}

/**
 * 종합 보고서 "앞으로 자본이 이동할 곳" 문단용 — 금 또는 실질금리 축 하나만 반대로 뒤집었을 때
 * 실제로 어느 사분면·점수로 이동하는지 scoreStep4를 다시 돌려 정확히 계산한다.
 * 예전엔 이 문구가 "현재 사분면 = 금↓실질금리↑"를 가정한 고정 텍스트라, 실제 현재 사분면이 다르면
 * (예: 금↑실질금리↑) 앞뒤가 안 맞았다 — LLM이 그 모순을 메우려다 존재하지 않는 점수를 지어낸 사례가
 * 실제로 있었다(외부 감사 지적). flat(보합)은 "위/아래 어느 쪽으로도 아직 안 정해짐"이라 뒤집을
 * 기준 방향이 없으므로 up으로 뒤집는다(더 널리 쓰이는 관례적 기본값).
 */
function describeQuadrantFlip(
  axis: "gold" | "rate",
  goldDir: Direction,
  realRateDir: Direction,
  dollarDir: Direction,
  us30yPercentile: number | null
): string {
  const flip = (d: Direction): Direction => (d === "down" ? "up" : "down");
  const flippedGold = axis === "gold" ? flip(goldDir) : goldDir;
  const flippedRate = axis === "rate" ? flip(realRateDir) : realRateDir;
  const result = scoreStep4({
    goldDirection: flippedGold,
    realRateDirection: flippedRate,
    dollarDirection: dollarDir,
    us30yPercentile,
  });
  const axisLabel = axis === "gold" ? "금이" : "실질금리가";
  const directionLabel = axis === "gold" ? (flippedGold === "up" ? "상승" : "하락") : flippedRate === "up" ? "상승" : "하락";
  return `${axisLabel} ${directionLabel} 전환하면 '${result.quadrant}'(${result.score}/10)로 이동합니다`;
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
  tgaWithinNormalRange: boolean | null,
  reserveFlow: string | null
): string {
  const { overseasQualifyingCount: q, overseasTotalCount: t, finalScore } = step2Result;
  const ratio = t > 0 ? q / t : 0;
  const stance = ratio >= 5 / 7
    ? "뚜렷한 완화 국면"
    : ratio >= 3 / 7
      ? "신호가 엇갈리는 혼조 국면"
      : "대체로 위축된 국면";
  // 8단계 가중치 계산표(아래 details.step8)가 이 점수를 소수점 둘째 자리(.toFixed(2))로 다시 보여주며
  // 실제 곱셈("3.33 × 2.5 = 8.33")을 검산할 수 있게 하는데, 여기 종합판단 요약이 소수점 첫째 자리만
  // 보여주면("3.3") 같은 값이 페이지 안에서 두 가지로 보여 스스로 검산하려는 사용자를 헷갈리게 한다
  // (외부 감사 지적, 실제 확인). 두 자리로 맞춘다.
  const lines = [`해외 유동성(시중에 도는 자금) 지표 ${q}/${t}개가 우호적 방향으로, 자본 흐름은 ${stance}입니다(2단계 점수 ${finalScore.toFixed(2)}/10).`];

  if (creditSpreadBp !== null) {
    lines.push(`크레딧 스프레드(회사채와 국채의 금리 차이 — 좁을수록 시장이 위험을 덜 두려워한다는 뜻)는 ${creditSpreadBp.toFixed(0)}bp로 "${creditSpreadZone(creditSpreadBp)}"입니다.`);
  }

  const auxParts: string[] = [];
  if (netLiqRising !== null) auxParts.push(`순유동성(연준 자산에서 정부 계좌·역레포 잔액을 뺀 값, 시중에 실제로 풀린 자금 규모)은 ${netLiqRising ? "상승" : "하락"} 추세`);
  if (rrpDepleted !== null) auxParts.push(`RRP(역레포 — 연준이 시중 자금을 하루짜리로 빌려두는 창구) 방파제는 ${rrpDepleted ? "고갈 경고" : "정상"}`);
  if (tgaWithinNormalRange !== null) auxParts.push(`TGA(재무부가 쓰기 전 은행에 넣어둔 돈, 줄어들수록 시중에 자금이 풀림)는 평균 대비 ${tgaWithinNormalRange ? "정상 범위" : "이탈"}`);
  if (auxParts.length > 0) lines.push(`${auxParts.join(", ")}입니다.`);

  if (reserveFlow !== null) lines.push(reserveFlow);

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
  const lines = [
    `미국-일본 10년물 국채 금리차(스프레드)가 ${step3Result.spreadBp}bp(1bp=0.01%p)로 "${step3Result.zone}" 구간에 있어, ` +
      `엔 캐리 트레이드(금리 낮은 엔화를 빌려 금리 높은 자산에 투자하는 전략 — 금리차가 좁아지면 원금 상환 압박으로 급하게 청산될 위험이 커짐)가 ${zoneDesc} 환경입니다.`,
  ];

  if (spreadPercentile !== null && cftcPercentile !== null) {
    const activity = cftcPercentile < 50 ? "활발한" : "저조한";
    lines.push(
      `이 금리차는 최근 1년 값 중 ${spreadPercentile}%ile(백분위 — 숫자가 높을수록 최근 1년 중 상위권이라는 뜻) 수준이고, ` +
        `CFTC(미국 선물거래위원회)에 신고된 엔화 선물 순포지션(캐리 트레이드 참여 규모의 대리 지표)은 ${cftcPercentile}%ile로 캐리 트레이드가 ${activity} 편입니다.`
    );
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

/** "A. B." 처럼 한 줄에 여러 문장이 붙어 있으면 마침표 뒤에서 끊어 문장별로 나눈다(가독성 최적화용). */
function splitSentences(text: string): string[] {
  return text.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * 4단계(금·실질금리 사분면) 판정 결과를 요약. summarizeStep2/3와 같은 원칙(결정론적, LLM 미사용).
 * 가독성을 위해 한 줄에 문장 하나만 오도록 만든다 — pure.ts의 note가 문장 2개를 담고 있는
 * 경우가 있어(예: "흔치 않은 조합... . 1단계부터 재확인 필요") splitSentences로 풀어서 각각 별도 줄로 낸다.
 * 마지막 줄은 환율·유가가 왜 그렇게 움직였는지를 1~3단계 결과(거부권·유동성 국면·엔 캐리 압박)에서 추론해 붙인다 —
 * 원인이 여러 개면 리스크가 큰 순서(거부권 > 엔 캐리 청산 압박 > 유동성 위축)로 하나만 골라 짧게 유지한다.
 */
function summarizeStep4(
  step4Result: { quadrant: string; note: string; score: number; dollarConfirms: boolean },
  fxOilDirection: { dollarDir: Direction; oilDir: Direction; oilChangePct: number | null; brentChangePct: number | null },
  context: {
    overseasQualifyingCount: number;
    overseasTotalCount: number;
    carryZone: string;
    jpySpike: boolean;
  }
): string {
  const lines: string[] = [];
  lines.push(
    `금값 방향과 실질금리(명목금리에서 물가상승률을 뺀 값, 진짜 구매력 기준 금리) 방향의 조합을 4가지 국면(사분면)으로 나눠 보면, ` +
      `지금은 그중 "${step4Result.quadrant}" 국면입니다(4단계 점수 ${step4Result.score}/10).`
  );
  lines.push(...splitSentences(step4Result.note.endsWith(".") ? step4Result.note : `${step4Result.note}.`));
  lines.push(
    step4Result.dollarConfirms
      ? "달러도 실질금리와 같은 방향으로 움직이고 있어 신호가 강한 편입니다."
      : "달러는 실질금리와 다른 방향으로 움직이고 있어 디커플링(신호 약화) 경계가 필요합니다."
  );

  // 유가 급등 오버라이드: 원래 로직은 달러(USD/KRW) 하락 하나만 보고 Risk-On을 판정해서, 지정학
  // 리스크로 유가가 급등한 날에도 "신흥국으로 자금 확산"이라고 잘못 읽는 경우가 있었다(예:
  // 2026-07-29 브렌트유 +7.9%·코스피 서킷브레이커가 겹쳤는데 원화 약세만 보고 Risk-On 판정).
  // 일간 유가 상승률이 +3%를 넘으면 지정학적 공급 충격일 가능성이 커서, 환율 방향과 무관하게
  // Risk-Off로 강제한다. 처음엔 WTI 하나만 봤는데, 브렌트를 이미 받아오면서도 판정엔 안 써서
  // WTI만 데이터 이상으로 튀어도(소스 오류·정산가 불일치 등) 그대로 통과하는 문제가 있었다(외부
  // 감사 지적, 실제 확인) — 두 유종이 같이 튀는지 확인하고, 둘이 크게 어긋나면 데이터 이상으로 본다.
  const bothOilSpike =
    fxOilDirection.oilChangePct !== null && fxOilDirection.oilChangePct > 3 &&
    fxOilDirection.brentChangePct !== null && fxOilDirection.brentChangePct > 3;
  const oilDataMismatch =
    fxOilDirection.oilChangePct !== null && fxOilDirection.brentChangePct !== null &&
    Math.abs(fxOilDirection.oilChangePct - fxOilDirection.brentChangePct) > 2;
  const oilSpike = bothOilSpike;

  const riskStance = oilSpike
    ? "Risk-Off(위험자산 회피 — 유가 급등, 지정학 리스크 우선 반영)"
    : fxOilDirection.dollarDir === "up" && fxOilDirection.oilDir === "up"
      ? "Risk-Off(위험자산 회피 — 자본이 미국에 갇힘)"
      : fxOilDirection.dollarDir === "down"
        ? "Risk-On(위험자산 선호 — 신흥국으로 자금 확산)"
        : "혼조";

  // 이전엔 여기서 1단계 거부권 발동 여부를 근거로 끌어다 썼는데, 거부권은 8단계에서 이미 한 번 더
  // 등급을 깎는 데 쓰인다 — 4단계 서술이 1단계 결과를 다시 인용하면 같은 정보가 두 번 반영되는
  // 셈이라 신호 독립성이 깨진다. 4단계는 4단계 자신과 2·3단계(유동성·캐리) 데이터만으로 서술한다.
  let reason: string;
  if (oilSpike) {
    reason = `유가가 하루 만에 ${fxOilDirection.oilChangePct!.toFixed(1)}% 급등해 공급 충격 우려가 원화 약세 신호보다 우선 반영된 것으로 보입니다.`;
  } else if (context.jpySpike || context.carryZone === "위험") {
    reason = "3단계 엔 캐리 트레이드 청산 압박(스프레드 위험 구간 또는 엔화 변동성 급등)이 환시 변동성을 키운 것으로 보입니다.";
  } else if (context.overseasTotalCount > 0 && context.overseasQualifyingCount / context.overseasTotalCount < 3 / 7) {
    reason = "2단계 해외 유동성이 위축된 국면이라 위험자산 대비 달러 선호가 반영된 것으로 보입니다.";
  } else {
    reason = "1~3단계에서 뚜렷한 리스크 신호는 없어 통상적인 변동 범위 안에서 움직인 것으로 보입니다.";
  }
  lines.push(`환율·유가는 ${riskStance} 흐름입니다.`);
  lines.push(reason);
  if (oilDataMismatch) {
    lines.push(
      `WTI ${fxOilDirection.oilChangePct!.toFixed(1)}% / 브렌트 ${fxOilDirection.brentChangePct!.toFixed(1)}%로 두 유종 변동률이 2%p 넘게 어긋나 있어 소스 데이터 이상 가능성이 있습니다.`
    );
  }

  return lines.join("\n");
}

/**
 * 5단계(규모별·성격별 자금 도착) 판정 결과를 요약. summarizeStep2/3/4와 같은 원칙(결정론적, LLM 미사용).
 * 나스닥100 vs 러셀2000(쏠림 여부), 다우존스 vs S&P500(위험선호), 암호화폐 동조 여부 순서로 서술한다.
 */
interface BigTechMover {
  label: string;
  change: { changePct: number | null };
  reason: string;
}

function summarizeStep5(
  step5Result: Step5Result,
  ndxReturn20d: number,
  rutReturn20d: number,
  djiReturn20d: number,
  spxReturn20d: number,
  gapPercentile: number | null,
  topBigTechMover: BigTechMover | null
): string {
  const lines: string[] = [];

  // 격차(gapPp)만 보면 "둘 다 하락하는데 격차만 작은 날"과 "둘 다 상승하는데 격차만 작은 날"이
  // 똑같이 "건강한 순환매"로 잡힌다 — 격차는 방향에 눈이 멀어 있어서, 실제 두 지수 수익률의
  // 부호를 직접 봐야 동반 하락(광범위 이탈)과 순환매(자금이 옮겨다니는 것)를 구분할 수 있다.
  const bothNegative = ndxReturn20d < 0 && rutReturn20d < 0;
  const concentrationDesc = step5Result.concentrationWarning
    ? step5Result.gapPp > 0
      ? "대형 기술주(나스닥100) 쪽으로 자금이 쏠리는 집중 장세"
      : "중소형주(러셀2000) 쪽으로 자금이 쏠리는 구간"
    : bothNegative
      ? "나스닥100·러셀2000 둘 다 하락하는 동반 약세(순환매가 아니라 광범위한 자금 이탈)"
      : "나스닥100·러셀2000이 비슷하게 움직이는 건강한 순환매";
  lines.push(
    `나스닥100 ${ndxReturn20d.toFixed(2)}% / 러셀2000 ${rutReturn20d.toFixed(2)}%(20거래일)로 격차 ${step5Result.gapPp.toFixed(2)}%p — ${concentrationDesc}입니다.`
  );
  if (gapPercentile !== null) {
    lines.push(`이 격차는 최근 1년 값 중 ${gapPercentile}%ile(백분위 — 숫자가 높을수록 최근 1년 중 상위권) 수준입니다.`);
  }

  const riskDesc = step5Result.riskAppetite === "위험선호"
    ? "S&P500이 다우존스를 앞서며 위험자산 선호 심리가 우세"
    : step5Result.riskAppetite === "안전선호"
      ? "다우존스가 S&P500을 앞서며 안전자산(전통 우량주) 선호 심리가 우세"
      : "다우존스·S&P500이 비슷하게 움직여 위험선호 방향성은 중립";
  lines.push(`다우존스 ${djiReturn20d.toFixed(2)}% / S&P500 ${spxReturn20d.toFixed(2)}%(20거래일)로 ${riskDesc}입니다.`);

  if (step5Result.cryptoAlignsWithRisk !== null) {
    lines.push(
      step5Result.cryptoAlignsWithRisk
        ? "비트코인·이더리움도 나스닥과 같은 방향으로 움직여 위험선호 심리에 동조하고 있습니다."
        : "비트코인·이더리움은 나스닥과 다른 방향으로 움직이고 있어 코인 고유 이슈(규제·수급 등)가 있을 가능성이 있습니다."
    );
  }

  // 나스닥100 쏠림·순환매 판정이 실제로 어느 종목에서 나오는지 짚어준다 — 원인은 LLM(Groq)이 뉴스
  // 헤드라인으로 판정한 값을 그대로 쓰고, 확인 안 된 경우 지어내지 않는다(데이터 정직성 원칙).
  if (topBigTechMover && topBigTechMover.change.changePct !== null) {
    const { label, reason } = topBigTechMover;
    const pct = topBigTechMover.change.changePct;
    const sign = pct >= 0 ? "+" : "";
    const isUnresolved = reason === "명확한 원인 확인 안 됨" || reason === "원인 확인 못함(Gemini 미판정)";
    lines.push(
      isUnresolved
        ? `빅테크 7 중 가장 크게 움직인 종목은 ${label}(${sign}${pct.toFixed(2)}%)이나, 뚜렷한 원인은 확인되지 않았습니다.`
        : `빅테크 7 중 가장 크게 움직인 종목은 ${label}(${sign}${pct.toFixed(2)}%)입니다.`
    );
    if (!isUnresolved) lines.push(reason);
  }

  return lines.join("\n");
}

/**
 * 6단계 섹터별 판정 근거를 규칙 기반으로 짧게 설명한다. 실제 뉴스·산업 동향을 조회해 서술하는 게 아니라
 * (v2 프롬프트의 데이터 정직성 원칙상 확인 안 된 원인을 지어내지 않는다), 이미 계산된 수익률·거래량
 * 수치만으로 판정 가능한 범위에서 해석한다. 실제 원인 조사는 카드 하단의 TrendForce·히트맵 링크로 유도한다.
 */
function sectorRationale(qualifying: boolean, return5d: number, volumeRatio: number): string {
  if (qualifying) return "5일 수익률 상위권 + 거래량 급증 — 자금 유입 신호";
  if (return5d > 0 && volumeRatio >= 1.3) return "거래량은 급증했지만 상위 3위 밖 — 관심 초기 단계일 수 있음";
  if (return5d > 0) return "완만한 상승, 거래량 뒷받침은 부족";
  return "5일 수익률 하락 — 자금 이탈 또는 관망 국면";
}

/**
 * 6단계(섹터) 판정 결과를 요약. summarizeStep2~5와 같은 원칙(결정론적, LLM 미사용).
 * 어느 섹터로 자금이 몰렸는지(qualifying) + 5일 수익률 1위 섹터를 알려준다.
 */
function summarizeStep6(step6Result: { qualifying: string[] }, sectors: SectorInput[]): string {
  const lines: string[] = [];
  lines.push(
    step6Result.qualifying.length > 0
      ? `자금은 ${step6Result.qualifying.join(", ")} 섹터로 몰리고 있습니다(5일 수익률 상위 3위 + 거래량 급증 동시 충족).`
      : "5일 수익률 상위 3위이면서 거래량까지 급증한 섹터는 없어 뚜렷한 자금 쏠림은 감지되지 않았습니다."
  );
  const sorted = [...sectors].sort((a, b) => b.return5d - a.return5d);
  if (sorted.length > 0) {
    lines.push(`5일 수익률 1위는 ${sorted[0].name} (${sorted[0].return5d.toFixed(2)}%)입니다.`);
  }
  lines.push("정확한 이동 원인은 산업 트렌드 링크에서 직접 확인하는 걸 권장합니다.");
  return lines.join("\n");
}

/**
 * 7단계 종합판단 — 기관·내부자 자금이 어디로 흘러갔고 전단계(5·6단계)와 일치하는지,
 * VIX·공포탐욕지수가 극단(과열/공포)인지에 따른 자본 유출입 시사점을 결정론적으로 진단한다.
 * VIX·F&G "변동 원인"은 뉴스 근거 없이 지어낼 수 없으므로(데이터 정직성 원칙), 실제 원인 서술이
 * 아니라 현재 수치가 어느 구간인지·그게 뭘 의미하는지로 해석한다.
 */
/** CNN 공식 사이트(edition.cnn.com/markets/fear-and-greed)의 5단계 분류 기준. */
function cnnFearGreedRating(value: number): string {
  if (value < 25) return "극단적 공포";
  if (value < 45) return "공포";
  if (value <= 55) return "중립";
  if (value <= 75) return "탐욕";
  return "극단적 탐욕";
}

function summarizeStep7(
  institutional: InstitutionalSignals | undefined,
  sectorMatch: string | null, // 6단계 qualifying과 실제로 일치한 섹터 라벨(없으면 null)
  tickerMatch: string | null, // 5단계 빅테크 7과 실제로 일치한 티커(없으면 null)
  vix: number | null,
  fearGreed: number | null,
  step7Result: { bothOverheated: boolean; fearZone: boolean }
): string {
  const lines: string[] = [];

  if (institutional) {
    // flowDesc(자금이 몰린 곳)와 matchDesc(전단계 일치 여부)가 서로 다른 근거를 말하면 안 된다 —
    // "금융 섹터로 몰렸고 일치합니다"인데 실제로는 티커 하나만 겹쳐서 일치 판정이 난 경우처럼
    // 섹터 얘기를 해놓고 티커 근거로 "일치"라고 잘라 말하면 오해를 부른다. 그래서 섹터 일치와
    // 티커 일치를 분리해서, flowDesc가 말하는 대상과 matchDesc의 근거가 항상 같은 걸 가리키게 한다.
    const flowDesc = institutional.topSectorLabel
      ? `${institutional.topSectorLabel} 섹터`
      : institutional.activityTickers[0]
        ? `${institutional.activityTickers[0]} 등 개별 종목 중심`
        : "뚜렷한 쏠림 없이 분산된 매수";
    lines.push(`슈퍼 투자자·내부자 자금은 최근 ${attachRo(flowDesc)} 몰렸습니다.`);

    if (sectorMatch) {
      lines.push("6단계에서 짚은 충족 섹터와 일치해 신호가 서로 보강됩니다.");
    } else if (tickerMatch) {
      lines.push("섹터 자체는 6단계 충족 섹터와 다른 흐름입니다.");
      lines.push(`다만 ${tickerMatch}은(는) 5단계 빅테크 매수와 겹쳐 부분적으로 참고할 만합니다.`);
    } else if (institutional.topSectorLabel || institutional.activityTickers.length > 0) {
      lines.push("5·6단계 분석과는 다른 흐름이라 참고 자료로만 활용하는 게 좋습니다.");
    } else {
      lines.push("비교할 만큼 데이터가 충분하지 않습니다.");
    }
  } else {
    lines.push("기관·내부자 매집 데이터를 확인하지 못했습니다.");
  }

  lines.push(
    vix === null
      ? "VIX(S&P500의 향후 변동성을 예상한 지수, '공포지수'라고도 불림 — 높을수록 시장이 불안하다는 뜻) 데이터를 확인하지 못했습니다."
      : vix < VIX_OVERHEAT_BELOW
        ? `VIX(S&P500의 향후 변동성을 예상한 지수, '공포지수'라고도 불림)는 ${vix.toFixed(2)}로 과열 구간(${VIX_OVERHEAT_BELOW} 미만 — 시장이 위험을 너무 안 두려워하는 상태)입니다.`
        : vix > VIX_FEAR_ABOVE
          ? `VIX(S&P500의 향후 변동성을 예상한 지수, '공포지수'라고도 불림)는 ${vix.toFixed(2)}로 공포 구간(${VIX_FEAR_ABOVE} 초과)입니다.`
          : `VIX(S&P500의 향후 변동성을 예상한 지수, '공포지수'라고도 불림)는 ${vix.toFixed(2)}로 중립입니다.`
  );
  lines.push(
    fearGreed === null
      ? "공포탐욕지수(시장 심리를 0~100으로 나타낸 CNN 지수)를 확인하지 못했습니다."
      // "~구간입니다"라고 쓰면 아래 표의 "공포 구간(역발상 매수용 극단 신호, <25 또는 VIX>25만 해당)"
      // 배지와 같은 문구로 오인돼 서로 다른 기준(CNN 5단계 vs 극단치)이 충돌해 보이는 문제가 있었다 —
      // 여기서는 CNN 자체 등급명을 인용한다는 걸 명확히 하려고 "~단계"로 구분한다.
      : `공포탐욕지수(시장 심리를 0~100으로 나타낸 CNN 지수)는 ${fearGreed.toFixed(1)}로 CNN 기준 '${cnnFearGreedRating(fearGreed)}' 단계입니다.`
  );
  lines.push(
    step7Result.bothOverheated
      ? "양쪽 다 과열 신호라 추가 자금 유입 여력은 줄고 단기 조정 위험이 커진 상태입니다."
      : step7Result.fearZone
        ? "극단적 공포/VIX 급등 신호가 감지돼 역발상 매수 기회일 수 있지만, 추가 자금 이탈 위험도 함께 살펴야 합니다."
        : "둘 다 극단적이지 않아 자본 유출입에 특별한 경고 신호는 없습니다."
  );

  return lines.join("\n");
}

interface DailyChange {
  latest: number | null;
  changeAmount: number | null;
  changePct: number | null;
  source: string | null; // "yahoo" | "fred" 등 — fred면 Yahoo가 실패해 폴백된 값이라는 뜻
  daysOld: number | null; // 최신값의 날짜가 오늘로부터 며칠 전인지
  prevGapDays: number | null; // curr와 prev 사이 날짜 간격 — 파이프라인이 하루 실패하면 "전일 대비"가
  // 실제로는 며칠치 누적 변동일 수 있다(외부 감사 지적, 실제 확인: 최근 2"행"만 볼 뿐 날짜가
  // 붙어있는지 검사 안 함). 주말·연휴로 인한 정상적인 3~4일 간격과는 구분해서 표시한다.
}

/**
 * 지표의 최신값과 직전 데이터포인트 대비 변동액·변동률. 4단계 환율·유가 보조 지표에 쓴다.
 * USD/KRW·USD/JPY·WTI·브렌트는 평소 Yahoo(당일 종가)가 채우고, Yahoo가 실패한 날에만
 * FRED(연준·EIA 공식 소스, 2~3영업일 지연)로 자동 대체된다 — source로 어느 쪽인지 구분한다.
 */
async function dailyChange(metric: string, asOf: Date = new Date()): Promise<DailyChange> {
  const [prev, curr] = await getMetricHistoryByCount(metric, 2, asOf);
  if (!curr) return { latest: null, changeAmount: null, changePct: null, source: null, daysOld: null, prevGapDays: null };
  const daysOld = daysBetween(asOf, curr.date);
  if (!prev) return { latest: curr.value, changeAmount: null, changePct: null, source: curr.source, daysOld, prevGapDays: null };
  const changeAmount = curr.value - prev.value;
  const changePct = prev.value !== 0 ? (changeAmount / prev.value) * 100 : null;
  const prevGapDays = daysBetween(curr.date, prev.date);
  return { latest: curr.value, changeAmount, changePct, source: curr.source, daysOld, prevGapDays };
}

/** dailyChange 결과를 "값 (단위) — 전일 대비 ±값 (단위), ±값%" 형태의 표시 문자열로 만든다. */
function fmtDailyChange(c: DailyChange, unit: string, decimals = 2): string {
  // 며칠째 값이 안 갱신됐으면(Yahoo·CoinGecko 등 소스 불문) "오늘 값"인 척하지 않고 확인 못함으로 처리.
  if (c.latest === null || (c.daysOld !== null && c.daysOld >= STALE_UNKNOWN_DAYS)) return "확인 못함";
  const latestStr = fmt(c.latest, decimals, unit);
  // Yahoo가 실패해 FRED로 대체된 값이면 그 사실을, 대체 없이 그냥 며칠 묵은 값이면 "N일 전 데이터"를
  // 명시해서 "당일 값"으로 오해하지 않게 한다.
  const staleNote =
    c.source === "fred"
      ? ` (FRED 대체, ${c.daysOld}일 전)`
      : c.daysOld !== null && c.daysOld >= STALE_WARN_DAYS
        ? ` (${c.daysOld}일 전 데이터)`
        : "";
  if (c.changeAmount === null || c.changePct === null) return `${latestStr}${staleNote}`;
  const sign = c.changeAmount >= 0 ? "+" : "";
  // 주말·연휴로 인한 3~4일 간격은 정상이라 "전일 대비"로 그대로 표시하지만, 그보다 크면(파이프라인이
  // 하루 이상 실제로 실패한 경우) "전일"이라는 표현이 거짓이 되므로 실제 간격을 명시한다.
  const label = c.prevGapDays !== null && c.prevGapDays > 4 ? `${c.prevGapDays}일 전 대비` : "전일 대비";
  return `${latestStr}${staleNote} — ${label} ${sign}${comma(c.changeAmount, decimals)} (${unit}), ${sign}${c.changePct.toFixed(2)}%`;
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
// risingCheck·fallingCheck는 비교 방향(<= vs >=)만 다른 동일 로직이었다 — 하나로 합친다.
async function trendCheck(
  metric: string,
  periods: number,
  direction: "rising" | "falling",
  asOf: Date = new Date()
): Promise<TrendCheck> {
  const history = await getMetricHistoryByCount(metric, periods + 1, asOf);
  const latestValue = history.length > 0 ? history[history.length - 1].value : null;
  if (history.length < periods + 1) return { met: null, latestValue };
  let met = true;
  for (let i = 1; i < history.length; i++) {
    const brokeTrend = direction === "rising" ? history[i].value <= history[i - 1].value : history[i].value >= history[i - 1].value;
    if (brokeTrend) { met = false; break; }
  }
  return { met, latestValue };
}

async function risingCheck(metric: string, periods: number, asOf: Date = new Date()): Promise<TrendCheck> {
  return trendCheck(metric, periods, "rising", asOf);
}

async function fallingCheck(metric: string, periods: number, asOf: Date = new Date()): Promise<TrendCheck> {
  return trendCheck(metric, periods, "falling", asOf);
}

/**
 * M2의 원본 기준은 "값 자체가 늘었는가"가 아니라 "전년 동월 대비(YoY) 증가율이 2개월 연속 상향"이다 —
 * 즉 성장 자체가 아니라 성장 속도가 가속되는지를 본다(노션 v2 프롬프트 원문 그대로).
 * YoY(이번달) > YoY(지난달) > YoY(지지난달)이면 충족.
 */
async function m2YoyAcceleration(asOf: Date = new Date()): Promise<TrendCheck & { detail: string }> {
  const history = await getMetricHistoryByCount(METRICS.M2, 20, asOf); // 3개월치 YoY 계산에 최소 15개월 필요, 여유 있게 20개
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
  // 엄격한 부등호(a>b>c)는 노이즈 한 틱에도 뒤집힌다 — 예: 0.85%p 가속한 뒤 마지막 구간만 0.05%p
  // 감속해도(측정 노이즈 범위 안) "미충족"으로 떨어진다(외부 감사 지적, 실제 확인). 최소 변화폭
  // 이내(±TOLERANCE)의 하락은 "사실상 유지"로 보고 감속으로 치지 않는다.
  const TOLERANCE_PP = 0.1;
  const met = yoy[1] - yoy[0] > -TOLERANCE_PP && yoy[2] - yoy[1] > -TOLERANCE_PP && yoy[2] > yoy[0];
  return { met, latestValue, detail: `YoY 증가율 ${yoy.map((v) => `${v.toFixed(2)}%`).join(" → ")}` };
}

/**
 * 월가 순유동성(Net Liquidity) = 연준 총자산(WALCL) - TGA - RRP.
 * TGA·RRP는 연준 대차대조표상 부채 항목이라 이게 줄면 그만큼 시중 은행 지급준비금(실제 유동성)이
 * 늘어난다는 회계 항등식에 기반한다. 원본 프롬프트의 "지표 하나씩 개별 판정" 구조를 유지하려고
 * 해외 지표 7개 집계엔 넣지 않고 참고용 보조 지표로만 보여준다 — 방향성(상승/하락) 확인용.
 * 세 시리즈 모두 이미 수집돼있는 데이터라 별도 백필 없이 계산만 하면 된다.
 */
async function netLiquidityTrend(asOf: Date = new Date()): Promise<{ detail: string; risingTrend: boolean | null }> {
  const [walcl, tga, rrp] = await Promise.all([
    getMetricHistoryByCount(METRICS.WALCL, 5, asOf),
    getMetricHistoryByCount(METRICS.TGA, 5, asOf),
    getMetricHistoryByCount(METRICS.RRP, 5, asOf),
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

/**
 * 회계 항등식(기준잔액 = 연준 총자산-TGA-RRP)대로면 TGA·RRP가 줄어든 만큼 기준잔액이 늘어야
 * 정상이다 — 순유동성(월가 프레임워크)은 이 항등식의 "예상값"만 보여주고 실제 기준잔액이
 * 그 방향대로 움직였는지는 따로 확인하지 않는다. 여기서는 TGA·RRP 변화로 예상되는 기준잔액
 * 변화량과 실제 기준잔액 변화를 직접 대조해, 정말 그 경로로 흘러들어갔는지 아니면 연준
 * 총자산(WALCL) 변화 등 다른 요인이 끼어들었는지를 판정한다. netLiquidityTrend와 같은
 * 4기간 전 대비 창을 쓴다.
 */
async function reserveFlowNote(asOf: Date = new Date()): Promise<string | null> {
  const [walcl, tga, rrp, reserves] = await Promise.all([
    getMetricHistoryByCount(METRICS.WALCL, 5, asOf),
    getMetricHistoryByCount(METRICS.TGA, 5, asOf),
    getMetricHistoryByCount(METRICS.RRP, 5, asOf),
    getMetricHistoryByCount(METRICS.TOTRESNS, 5, asOf),
  ]);
  if (walcl.length < 5 || tga.length < 5 || rrp.length < 5 || reserves.length < 5) return null;

  const deltaWalcl = (walcl[4].value - walcl[0].value) / 1000; // 백만달러 -> 십억달러
  const deltaTga = (tga[4].value - tga[0].value) / 1000;
  const deltaRrp = rrp[4].value - rrp[0].value; // 이미 십억달러
  const deltaReserves = (reserves[4].value - reserves[0].value) / 1000;
  // TGA·RRP 변화만 놓고 볼 때(연준 총자산 변화는 제외) 기준잔액이 받았어야 할 변화량.
  const expectedFromDrain = -(deltaTga + deltaRrp);
  const fmtBn = (v: number) => `${v >= 0 ? "+" : ""}${comma(v, 1)}십억달러`;

  if (Math.abs(expectedFromDrain) < 1 && Math.abs(deltaReserves) < 1) {
    return "최근 TGA·RRP·기준잔액 모두 큰 변화가 없어 자금 이동은 뚜렷하지 않습니다.";
  }

  const sameDirection = (expectedFromDrain >= 0) === (deltaReserves >= 0);
  if (sameDirection) {
    const verb = expectedFromDrain >= 0
      ? "RRP·TGA에서 빠진 돈이 기준잔액으로 흘러들어간"
      : "기준잔액에서 빠진 돈이 RRP·TGA로 흘러들어간";
    return `TGA·RRP 변화분(${fmtBn(expectedFromDrain)})과 기준잔액 실제 변화(${fmtBn(deltaReserves)})의 방향이 같아, ${verb} 것으로 보입니다.`;
  }
  return `TGA·RRP 변화분(${fmtBn(expectedFromDrain)})과 기준잔액 실제 변화(${fmtBn(deltaReserves)})의 방향이 달라, 그만큼은 흘러들어가지 않고 연준 총자산(WALCL) 변화(${fmtBn(deltaWalcl)}) 등 다른 경로로 설명해야 합니다.`;
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
async function tgaDeviationFromRecentAverage(asOf: Date = new Date()): Promise<{ detail: string; withinNormalRange: boolean | null }> {
  const history = await getMetricHistoryByCount(METRICS.TGA, 9, asOf);
  if (history.length < 9) return { detail: "데이터 부족", withinNormalRange: null };
  const current = history[history.length - 1].value;
  const baseline = history.slice(0, 8).reduce((a, b) => a + b.value, 0) / 8;
  const deviationPct = ((current - baseline) / baseline) * 100;
  return {
    detail: `${comma(current / 1000)} (십억달러) — 최근 8기간 평균 ${comma(baseline / 1000)} (십억달러) 대비 ${deviationPct >= 0 ? "+" : ""}${deviationPct.toFixed(1)}%`,
    withinNormalRange: Math.abs(deviationPct) < 10,
  };
}

// directionOfWithFreshness(아래)의 daysOld 없는 축약형 — 대부분의 호출부는 방향만 필요하다.
async function directionOf(metric: string, asOf: Date = new Date()): Promise<Direction | null> {
  return (await directionOfWithFreshness(metric, asOf)).direction;
}

// Yahoo(등 매일 갱신을 전제로 하는 소스)가 며칠째 막혔을 때, "확인 못함"으로 완전히 숨기지도
// "오늘 값"인 척 보여주지도 않기 위한 2단계 경계값. 주말·짧은 휴장 정도는 정상 범위로 넘어가고
// (WARN 미만은 라벨 없이 그대로 표시), 그보다 오래되면 "N일 전 데이터" 라벨을 붙이고, 20일 수익률·
// z-score 같은 일별 계산에 쓰기엔 너무 오래되면(UNKNOWN 이상) 확인 못함으로 처리한다.
// FRED 월간 지표(REAL_RATE 등)에는 적용하지 않는다 — 발표 주기 자체가 몇 달이라 오작동으로 오인한다.
const STALE_WARN_DAYS = 4;
const STALE_UNKNOWN_DAYS = 10;

// 날짜창(예: 최근 10일) 방식은 월간 지표(REAL_RATE 등)가 발표 지연 시 데이터 0~1개만 잡혀
// 늘 null->"flat"로 새는 버그가 있었다 — "최근 2개 데이터포인트"로 바꿔 발표 주기와 무관하게 동작.
/** directionOf(방향만)와 같은 로직에 최신 데이터포인트가 며칠 전 것인지(daysOld)도 함께 돌려준다(Yahoo 일별 지표 전용). */
async function directionOfWithFreshness(
  metric: string,
  asOf: Date = new Date()
): Promise<{ direction: Direction | null; daysOld: number | null }> {
  const [prev, curr] = await getMetricHistoryByCount(metric, 2, asOf);
  if (!prev || !curr) return { direction: null, daysOld: null };
  const daysOld = daysBetween(asOf, curr.date);
  if (curr.value > prev.value) return { direction: "up", daysOld };
  if (curr.value < prev.value) return { direction: "down", daysOld };
  return { direction: "flat", daysOld };
}

/** directionOfWithFreshness + "STALE_UNKNOWN_DAYS 이상 묵었으면 flat으로 폴백" 판정까지 한 번에.
 * 금·달러(DXY) 둘 다 이 3줄짜리 fresh→stale→fallback 패턴을 각자 복붙해 쓰고 있었다. */
async function freshDirection(
  metric: string,
  asOf: Date
): Promise<{ dir: Direction; stale: boolean; daysOld: number | null }> {
  const fresh = await directionOfWithFreshness(metric, asOf);
  const stale = fresh.daysOld !== null && fresh.daysOld >= STALE_UNKNOWN_DAYS;
  return { dir: stale ? "flat" : fresh.direction ?? "flat", stale, daysOld: fresh.daysOld };
}

/**
 * USD/JPY 확정 종가(METRICS.USDJPY, 09시 파이프라인이 하루 1회만 기록) 기준 일간 변동률을
 * 최근 19개 변동률의 평균·표준편차와 비교(z-score). |z| > 2 이거나 하루 변동률이 1.5%를
 * 넘으면 "급등"으로 본다 — 표준편차가 아주 작을 때도 절대 임계값으로 걸러지도록 두 조건을
 * OR로 묶었다. 데이터가 21개 미만이면 판정 보류(급등 아님).
 *
 * 여기에 더해 인트라데이 경보(jpy-check 크론이 METRICS.USDJPY_INTRADAY에 하루 여러 번 기록)도
 * 같이 본다 — 종가 대 종가 비교만으로는 "마지막 확정 종가 이후 장중에 이미 크게 움직였다"를
 * 다음날 09시까지 못 잡는다. 확정 종가 시계열은 절대 건드리지 않고 별도 지표로만 비교한다
 * (예전엔 이 크론이 USDJPY 행 자체를 덮어써서 종가 기준점이 사라지는 문제가 있었다 — 외부 감사
 * 지적, 실제 확인. METRICS.USDJPY_INTRADAY 분리로 해결).
 */
async function detectJpyVolSpike(
  asOf: Date = new Date()
): Promise<{
  spike: boolean;
  zScore: number | null;
  latestReturnPct: number | null;
  intradayReturnPct: number | null;
}> {
  const history = await getMetricHistory(METRICS.USDJPY, 60, asOf);
  const lastClose = history[history.length - 1] ?? null;

  let closeSpike = false;
  let zScore: number | null = null;
  let latestReturnPct: number | null = null;
  if (history.length >= 21) {
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
    closeSpike = Math.abs(z) > 2 || Math.abs(latestReturn) > 0.015;
    zScore = Number(z.toFixed(2));
    latestReturnPct = Number((latestReturn * 100).toFixed(2));
  }

  let intradaySpike = false;
  let intradayReturnPct: number | null = null;
  const intraday = await getLatestMetric(METRICS.USDJPY_INTRADAY, asOf);
  if (lastClose && intraday && intraday.date > lastClose.date) {
    intradayReturnPct = Number((((intraday.value - lastClose.value) / lastClose.value) * 100).toFixed(2));
    intradaySpike = Math.abs(intradayReturnPct) > 1.5;
  }

  return { spike: closeSpike || intradaySpike, zScore, latestReturnPct, intradayReturnPct };
}

/**
 * 오늘자 v2 체크리스트 전체를 DB 데이터로 계산한다.
 * 지표가 없으면 해당 판정은 null(모름)로 남기고 억지로 채우지 않는다 —
 * 원칙: "확인 못하면 확인 못함이라고 쓴다"(v2 프롬프트 핵심 원칙).
 *
 * 뉴스 판정(1단계)은 매일 파이프라인이 미리 수집·LLM(Mistral) 판정해 NewsEvent에 저장해둔 것을 읽기만 한다 —
 * 여기서 다시 뉴스를 가져와 판정하면 페이지를 열 때마다 LLM을 호출하게 되므로 분리했다.
 * FOMC·CPI·고용지표 등 "14일 내 큰 이벤트"도 마찬가지로 MajorEvent 테이블을 읽기만 한다.
 * 엔화 변동성 급등은 이미 저장된 USD/JPY 시계열로 그때그때 계산한다(DB 조회만 필요, 비용 없음).
 *
 * CNN 공포탐욕지수(공식 API 없음)와 섹터 5일 수익률(수동/외부 조회)만 여전히 별도 인자로 받는다.
 *
 * details: 각 단계 판정에 쓰인 실제 기준·수치를 UI 표로 보여주기 위한 행 데이터.
 * 점수 계산과 별개 경로로 채워서, 표시용 가공이 점수 로직에 영향을 주지 않게 분리했다.
 */
export async function runDailyAnalysis(
  manualInputs: {
    sectors: SectorInput[];
    missingSectorLabels?: string[]; // fetchAllSectors에서 개별적으로 실패한 섹터 이름("라벨(티커)") — 확인 못함으로 명시
    bigTechReasons?: Record<string, string>;
    institutionalSignals?: InstitutionalSignals;
    putCallRatio?: number | null; // SPY 옵션 put/call 거래량 비율(Alpha Vantage). 임계값 미검증 — 참고 정보로만 노출
    krxShortBalance?: { date: string; ratio: number } | null; // KOSPI 시가총액가중 공매도 잔고비중(%, KRX). 임계값 미검증 — 참고 정보로만 노출
  },
  // 과거 특정 날짜(예: 지난주 어느 날) 기준으로 2~8단계를 정확히 재구성할 때 쓴다 — 생략하면
  // 기존과 동일하게 "지금 이 순간"을 기준으로 계산한다(일일 배치의 정상 동작은 무수정).
  // 뉴스·이벤트·지표 시계열 전부 이 날짜를 "오늘"로 취급해 그 시점 이후 데이터는 안 본다.
  asOf: Date = new Date()
) {
  const details = {} as StepDetails;

  // 1단계 — 거부권은 "리스크 뉴스 가중점수가 기준 이상" 또는 "최근 발표된 FOMC/CPI/고용지표 결과가
  // 서프라이즈"일 때 발동. 가중점수는 건수가 아니라 심각도·출처 신뢰도·최근성을 곱해 합산한 값이다
  // (월가 GPR·BGRI 방식 — newsItemWeight() 참고). (예정된 이벤트가 있다는 것만으로 발동하면
  // FOMC·CPI·고용지표를 합쳐 거의 매일 걸려서 거부권이 상시 발동해버림 — 그래서 "예정" 여부가 아니라
  // "지난 발표의 실제 결과"로 기준을 바꿨다. 예정 목록은 정보용으로만 따로 보여준다.)
  const riskyNews = await getRecentRiskyNews(7, asOf);
  const recentOutcomes = await evaluateRecentEventOutcomes(5, asOf);
  // getUpcomingMajorEvents는 asOf 당일 0시(KST) 이상(gte)을 "예정"으로 잡는데, 그 날 안에 이미
  // 발표까지 끝난 지표(recentOutcomes에 "실제 결과"로 이미 올라온 것)가 섞여 들어올 수 있다 —
  // 같은 이벤트가 "실제 결과: 예상 범위 내"와 "14일 내 예정된 이벤트" 양쪽에 동시에 뜨는 자기모순이
  // 실측 확인됐다(2026-08-08 리포트, 미국 고용지표 8/7). 두 함수의 날짜 경계 계산을 각각 손대는
  // 대신, 이미 결과가 나온 이벤트는 예정 목록에서 이름+날짜로 걸러낸다 — 어느 쪽 경계가 정확하든
  // 결과적으로 한 이벤트가 두 목록에 동시에 뜨는 일은 없다.
  const rawUpcomingEvents = await getUpcomingMajorEvents(14, asOf);
  const evaluatedKeys = new Set(recentOutcomes.map((o) => `${o.name}|${o.date}`));
  const upcomingEvents = rawUpcomingEvents.filter(
    (e) => !evaluatedKeys.has(`${e.name}|${e.date.toISOString().slice(0, 10)}`)
  );
  const hasEventSurprise = recentOutcomes.some((o) => o.risky);
  // "단독으로도 시장을 크게 흔들 수준"(severity=high) 판정은 LLM이 내리는데, 실측 결과 이 라벨이
  // 하루 1~2건씩 상시로 붙어 거부권이 21일 중 15일을 이 경로 하나로 발동시키고 있었다. 원인은
  // 라벨의 출처 분포다 — 저장된 high 44건 중 43건이 priority 2(일반 지정학 뉴스)이고 백악관·연준
  // 공식 발표발 high는 0건이었다. 즉 LLM이 일반 기사에 최고 심각도를 남발한다.
  //
  // 그래서 "단독 즉시발동"은 출처가 공식(0) 또는 권력네트워크 유출(1)인 high로 한정한다 — BGRI가
  // 브로커리지 리포트에 일반 매체보다 큰 비중을 두는 것과 같은 원리. 일반 매체발 high는 즉시발동
  // 대신 강도 점수(severity 가중치 3)로만 반영된다. 창도 7일 -> 2일로 좁힌다: 6일 전의 "충격 뉴스"가
  // 오늘의 결론을 뒤집는 건 최근성 감쇠를 쓰는 점수 경로와 앞뒤가 안 맞았다.
  // 실측 발동률: 71% -> 10%.
  const severeCutoff = new Date(asOf);
  severeCutoff.setUTCDate(severeCutoff.getUTCDate() - (SEVERE_NEWS_WINDOW_DAYS - 1));
  const hasSevereNews = riskyNews.some(
    (n) => n.severity === "high" && n.priority <= SEVERE_NEWS_MAX_PRIORITY && n.date >= severeCutoff
  );
  const newsRiskScore = riskyNews.reduce((sum, n) => sum + newsItemWeight(n, asOf), 0);
  const { intensity: newsRiskIntensity, usedCount: newsRiskItemsUsed, totalCount: newsRiskItemsTotal } =
    computeNewsRiskIntensity(riskyNews, asOf);
  const step1 = {
    ...scoreStep1({
      newsRiskScore,
      newsRiskIntensity,
      hasRecentEventSurprise: hasEventSurprise,
      hasSevereNewsInWindow: hasSevereNews,
    }),
    newsRiskIntensity,
    newsRiskItemsUsed,
    newsRiskItemsTotal,
    // 종합 보고서 LLM이 riskyNews 배열(많으면 100건 이상)을 직접 세다가 자릿수를 틀린 사례가
    // 실제로 있었다(148건을 39건으로 서술) — 미리 센 값을 별도 필드로 줘서 옮겨적기만 하면 되게 한다.
    riskyNewsCount: riskyNews.length,
    riskyNews: riskyNews.map((n) => ({
      title: n.title, url: n.url, summary: n.summary, date: n.date.toISOString().slice(0, 10),
      severity:
        n.severity === "high" ? ("high" as const) : n.severity === "low" ? ("low" as const) : ("medium" as const),
    })),
    upcomingEvents: upcomingEvents.map((e) => ({ name: e.name, date: e.date.toISOString().slice(0, 10) })),
    recentEventOutcomes: recentOutcomes,
    newsRiskScore,
  };
  // 뉴스 위험점수(newsRiskScore)가 20점이라는 절대 임계값 대비 몇 배인지만 보여주면, 그게 평소
  // 수준인지 이례적인지 알 방법이 없다(외부 감사 지적) — 판정에는 관여하지 않는 참고 정보로만
  // 최근 기록 대비 백분위를 병기한다. 표본이 3일 미만이면 null(정보 없음)로 조용히 생략.
  const newsRiskPercentile = await getNewsRiskScorePercentile(newsRiskScore, asOf);
  details.step1 = [
    {
      label: "최근 7일 리스크 뉴스 가중점수",
      criterion: `${NEWS_RISK_SCORE_THRESHOLD}점 미만\n(심각도·출처·최근성 반영)`,
      value: `${newsRiskScore.toFixed(1)}점(${riskyNews.length}건)`,
      met: newsRiskScore < NEWS_RISK_SCORE_THRESHOLD,
    },
    ...(newsRiskPercentile
      ? [
          {
            label: "최근 기록 대비 참고 맥락",
            criterion: "판정에 관여하지 않는 정보성 지표",
            value: `최근 ${newsRiskPercentile.sampleSize}일 중 상위 ${100 - newsRiskPercentile.percentile}% 수준`,
            met: null,
          },
        ]
      : []),
    {
      label: "단독 즉시발동 수준 뉴스(심각도 high)",
      criterion: "없음",
      value: hasSevereNews ? "있음" : "없음",
      met: !hasSevereNews,
    },
    ...recentOutcomes.map((o) => ({
      label: `${o.name}${o.subLabel ?? ""}(${slashDate(o.date)}) 실제 결과`,
      criterion: "예상 범위 내(서프라이즈 아님)",
      value: o.detail,
      // o.risky는 null(판정불가)일 수 있다 — !null이 true가 돼서 "충족(✓)"으로 잘못 보이면
      // 데이터가 없는데 "안전"이라고 말하는 fail-open이 된다. null은 met도 null(회색 "-")로 남긴다.
      met: o.risky === null ? null : !o.risky,
      url: o.url,
    })),
    {
      label: "14일 내 예정된 이벤트",
      criterion: "-",
      value: upcomingEvents.length > 0
        ? upcomingEvents.map((e) => `${e.name}(${slashDate(e.date.toISOString().slice(0, 10))})`).join("\n")
        : "없음",
      met: null,
    },
  ];

  // 2단계 — 원래는 7개 전부 "최근 N기간 연속 상승/하락" 트렌드만 봤다. 문제는 RRP·크레딧
  // 스프레드처럼 이미 구조적 바닥(또는 극단적으로 우호적인 수준)에 도달한 지표는 "더 나아짐"이
  // 물리적으로 불가능해 영구 미충족에 갇힌다는 점 — 연준 자체 금융여건지수(NFCI)나 월가가 하이일드
  // 스프레드를 percentile로 읽는 방식과도 다르다(트렌드가 아니라 수준을 본다). 그래서 WRESBAL·RRP·
  // 크레딧 스프레드 3개에는 "이미 충분히 우호적인 수준이면 트렌드와 무관하게 충족"이라는 예외를
  // 추가한다. 단, RRP는 다르다 — 실제 리서치(Apollo Academy 등)는 RRP 고갈을 "방파제가 사라져
  // 이후 QT가 지준을 직접 흡수하는 위험 국면"으로 읽지 "계속 우호적"으로 읽지 않는다. 그래서 RRP는
  // 자동 충족이 아니라 판정 자체를 무효화(N/A, 분모에서 제외)한다.
  const walcl = await risingCheck(METRICS.WALCL, 2, asOf);
  const m2 = await m2YoyAcceleration(asOf);
  const reserves = await risingCheck(METRICS.TOTRESNS, 4, asOf);
  const reservesPercentile = reserves.latestValue !== null
    ? await calculatePercentile(METRICS.TOTRESNS, reserves.latestValue, asOf)
    : null;
  // 2025-12 FOMC가 지준을 "ample(충분)" 수준으로 판단해 RMP(지준관리매입)로 일정 범위 내 유지를
  // 시작했다 — 즉 연준 스스로 "계속 늘어야 좋다"가 아니라 "목표 범위서 안정"을 목표로 삼는다.
  // 정확한 ample 달러 임계값은 명목 GDP 성장에 따라 계속 바뀌어 하드코딩하기 부적절하므로,
  // 자체 최근 1년 분포의 상위 25%(75%ile 이상)를 "이미 충분한 수준"의 근사치로 쓴다.
  const reservesAmple = reservesPercentile !== null && reservesPercentile >= 75;
  const rrp = await fallingCheck(METRICS.RRP, 3, asOf);
  const rrpStatus = rrp.latestValue !== null ? rrpBufferStatus(rrp.latestValue) : null;
  const tga = await fallingCheck(METRICS.TGA, 3, asOf);
  const realRate2 = await fallingCheck(METRICS.REAL_RATE, 3, asOf);
  // REAL_RATE는 FRED 월간 지표라 calculatePercentile의 "최근 365일" 날짜창에는 12~13개월치밖에
  // 안 잡혀 표본 30개 기준을 영원히 못 채운다 — risingCheck/fallingCheck가 월간 지표 때문에 날짜창
  // 대신 개수 기준으로 바꾼 것과 같은 문제라 calculatePercentileByCount(개수 기준)를 쓴다.
  const realRatePercentile = realRate2.latestValue !== null
    ? await calculatePercentileByCount(METRICS.REAL_RATE, realRate2.latestValue, 60, asOf)
    : null;
  const realRateAlreadyLow = realRatePercentile !== null && realRatePercentile <= 25;
  const creditSpread = await fallingCheck(METRICS.CREDIT_SPREAD, 3, asOf);
  const creditSpreadBp = creditSpread.latestValue !== null ? creditSpread.latestValue * 100 : null;
  // creditSpreadZone()이 이미 "과도한 낙관"으로 분류하는 구간과 동일한 기준(CREDIT_SPREAD_TIGHT_BP)을
  // 재사용 — 화면에 표시되는 구간 라벨과 점수 판정이 서로 다른 기준을 쓰던 불일치를 없앤다.
  const creditSpreadAlreadyTight = creditSpreadBp !== null && creditSpreadBp < CREDIT_SPREAD_TIGHT_BP;

  const step2 = scoreStep2({
    walclIncreasing: walcl.met,
    m2GrowthRising2Months: m2.met,
    reservesRising4Weeks: reservesAmple ? true : reserves.met,
    rrpDeclining: rrpStatus?.depleted ? null : rrp.met,
    tgaDeclining: tga.met,
    realRateFallingOrLowFlat: realRateAlreadyLow ? true : realRate2.met,
    creditSpreadNarrowing: creditSpreadAlreadyTight ? true : creditSpread.met,
  });
  details.step2 = [
    { label: "Fed 대차대조표(WALCL)", criterion: "최근 2기간 연속 증가", value: fmt(walcl.latestValue, 0, "백만달러"), met: walcl.met, url: FRED_URL("WALCL") },
    { label: "M2 통화량", criterion: "YoY 증가율 2개월 연속 상향\n(가속)", value: m2.detail, met: m2.met, url: FRED_URL("M2SL") },
    {
      label: "기준잔액(WRESBAL)",
      criterion: "최근 4주 연속 증가\n(또는 자체 1년 분포 상위 25%=이미 ample)",
      value: `${fmt(reserves.latestValue, 0, "백만달러")}${reservesPercentile !== null ? ` — ${reservesPercentile}%ile` : ""}`,
      met: reservesAmple ? true : reserves.met,
      url: FRED_URL("WRESBAL"),
    },
    {
      label: "RRP(역레포 잔액)",
      criterion: rrpStatus?.depleted ? "판정 무효(N/A)\n(방파제 고갈, 분모 제외)" : "최근 3기간 연속 감소",
      value: fmt(rrp.latestValue, 2, "십억달러"),
      met: rrpStatus?.depleted ? null : rrp.met,
      url: FRED_URL("RRPONTTLD"),
    },
    { label: "TGA(재무부 일반계정)", criterion: "최근 3기간 연속 감소", value: fmt(tga.latestValue, 0, "백만달러"), met: tga.met, url: FRED_URL("WTREGEN") },
    {
      label: "실질금리(10년)",
      criterion: "최근 3기간 연속 하락\n(또는 자체 이력 하위 25%=이미 낮은 수준)",
      value: `${fmt(realRate2.latestValue, 2, "%")}${realRatePercentile !== null ? ` — ${realRatePercentile}%ile` : " — 이력 부족(percentile 계산 불가)"}`,
      met: realRateAlreadyLow ? true : realRate2.met,
      url: FRED_URL("REAINTRATREARAT10Y"),
    },
    {
      label: "크레딧 스프레드(하이일드 OAS)",
      criterion: `최근 3기간 연속 축소\n(또는 ${CREDIT_SPREAD_TIGHT_BP}bp 미만=이미 과도한 낙관 구간)`,
      value: creditSpread.latestValue !== null
        ? `${(creditSpread.latestValue * 100).toFixed(0)}bp — ${creditSpreadZone(creditSpread.latestValue * 100)}`
        : "확인 못함",
      met: creditSpreadAlreadyTight ? true : creditSpread.met,
      url: FRED_URL("BAMLH0A0HYM2"),
    },
  ];

  // 보조 지표 4개 — 원본 프롬프트의 7개 지표 구조를 그대로 유지하려고 해외 지표 집계엔 안 넣고
  // "분석 기준·지표 상세 보기"와는 별도 토글("보조 지표 보기")로 뺀다.
  details.step2Aux = [];

  // BBB 등급 스프레드: 200bp 넘으면 우량 기업조차 차환에 어려움을 겪는다는 신호.
  const bbb = await getLatestMetric(METRICS.CREDIT_SPREAD_BBB, asOf);
  const bbbBp = bbb ? bbb.value * 100 : null;
  details.step2Aux.push({
    label: "BBB 등급 스프레드",
    criterion: "200bp 초과 시 우량기업 차환 어려움 경고",
    value: bbbBp !== null ? `${bbbBp.toFixed(0)}bp` : "확인 못함",
    met: bbbBp !== null ? bbbBp <= 200 : null,
    url: FRED_URL("BAMLC0A4CBBB"),
  });

  // 월가 순유동성 프레임워크(WALCL-TGA-RRP) 기반 보조 지표 3개.
  const netLiq = await netLiquidityTrend(asOf);
  details.step2Aux.push({
    label: "순유동성 Net Liquidity",
    criterion: "연준 총자산-TGA-RRP\n상승하면 증시에 우호적\n(월가 프레임워크)",
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
      url: FRED_URL("RRPONTTLD"),
    });
  }

  const tgaDeviation = await tgaDeviationFromRecentAverage(asOf);
  details.step2Aux.push({
    label: "TGA 최근 평균 대비 이탈도",
    criterion: "최근 8기간 평균 대비 ±10%p 이탈 시 경계(공식 QRA 목표치 근사)",
    value: tgaDeviation.detail,
    met: tgaDeviation.withinNormalRange,
    url: FRED_URL("WTREGEN"),
  });

  // 美 2Y-10Y 스프레드(FRED T10Y2Y): 신용·유동성보다 먼저 움직이는 선행 신호라 원본 프롬프트
  // 지표엔 없지만 참고용 경고로 추가한다 — 0bp 미만(장단기 역전)은 과거 경기침체 선행 신호로
  // 널리 쓰이는 임계값(역전 자체보다 역전이 "풀리는" 시점이 더 유명한 신호지만, 우선 역전 여부만
  // 표시하고 해석은 사용자 몫으로 남긴다 — 데이터 정직성 원칙).
  const t10y2y = await getLatestMetric(METRICS.US10Y_2Y10Y_SPREAD, asOf);
  const t10y2yBp = t10y2y ? t10y2y.value * 100 : null;
  // 스프레드가 0bp 이상이어도 "정상"이라고 단정할 수 없다 — 단기물이 내려서 양수인 경우(불
  // 스티프닝, 인하 기대·건강한 신호)와 장기물이 급등해서 양수인 경우(베어 스티프닝, 금융여건
  // 긴축·주식엔 악재)를 부호만으로는 구분 못 한다(외부 감사 지적, 실제 확인 — 2026-07-31처럼
  // 30년물이 자체 최고치로 급등하는데도 스프레드 부호만 보고 ✓로 표시된 사례). 30년물 방향을
  // 같이 봐서, 스프레드가 양수여도 30년물이 상승 중이면 베어 스티프닝으로 보고 met을 false로 뒤집는다.
  const us30yDir = await directionOf(METRICS.US30Y, asOf);
  const bearSteepening = t10y2yBp !== null && t10y2yBp >= 0 && us30yDir === "up";
  details.step2Aux.push({
    label: "美 2Y-10Y 스프레드",
    criterion: "0bp 미만(장단기 금리 역전)은 침체 선행 신호\n0bp 이상이어도 30년물이 같이 급등 중이면 베어 스티프닝(금융여건 긴축)으로 해석 — 부호만으로 판단하지 않음",
    value: t10y2yBp !== null
      ? `${t10y2yBp.toFixed(0)}bp${bearSteepening ? " — 베어 스티프닝 경계(30년물 동반 상승)" : ""}`
      : "확인 못함",
    met: t10y2yBp !== null ? (bearSteepening ? false : t10y2yBp >= 0) : null,
    url: FRED_URL("T10Y2Y"),
  });

  // 美 30년물 국채금리(FRED DGS30): 장단기 스프레드(T10Y2Y)는 역전 여부만 보여줘서, 역전 없이
  // 장기금리 자체가 급등하는 "베어 스티프닝"(채권시장에서 주식에 악재로 읽는 국면)은 못 잡는다.
  // 절대 수준의 좋고 나쁨을 판정할 보편적 임계값이 없어 met은 null로 남기고, 자체 1년 분포
  // 백분위만 참고용으로 보여준다 — 해석은 사용자 몫(데이터 정직성 원칙).
  const us30y = await getLatestMetric(METRICS.US30Y, asOf);
  const us30yPercentile = us30y ? await calculatePercentile(METRICS.US30Y, us30y.value, asOf) : null;
  details.step2Aux.push({
    label: "美 30년물 국채금리",
    criterion: "절대 수준 참고용(임계값 없음) — 급등 시 베어 스티프닝(장기금리 주도 약세) 경계",
    value: us30y !== null
      ? `${us30y.value.toFixed(2)}%${us30yPercentile !== null ? ` — 최근 1년 ${us30yPercentile}%ile` : ""}`
      : "확인 못함",
    met: null,
    url: FRED_URL("DGS30"),
  });

  // 美 2년물-기준금리 스프레드: 2년물은 향후 2년간 예상되는 정책금리 경로를 선반영하는 성격이 있어,
  // 기준금리보다 낮으면 시장이 인하를, 높으면 인상을 가격에 반영 중이라고 널리 해석된다(CME FedWatch
  // 같은 선물 내재확률의 무료 대체 근사치 — 정확한 확률값은 아니고 방향성 참고용).
  const us2y = await getLatestMetric(METRICS.US2Y, asOf);
  const fedFunds = await getLatestMetric(METRICS.FED_FUNDS_RATE, asOf);
  const us2yFfrSpreadBp = us2y && fedFunds ? (us2y.value - fedFunds.value) * 100 : null;
  details.step2Aux.push({
    label: "美 2년물-기준금리 스프레드",
    criterion: "음수면 시장이 향후 금리 인하를, 양수면 인상을 가격에 반영 중으로 해석\n(방향성 참고용)",
    value: us2yFfrSpreadBp !== null ? `${us2yFfrSpreadBp >= 0 ? "+" : ""}${us2yFfrSpreadBp.toFixed(0)}bp` : "확인 못함",
    met: null,
    url: FRED_URL("DGS2"),
  });

  const reserveFlow = await reserveFlowNote(asOf);
  details.step2Summary = summarizeStep2(
    step2,
    creditSpread.latestValue !== null ? creditSpread.latestValue * 100 : null,
    netLiq.risingTrend,
    rrpDepleted,
    tgaDeviation.withinNormalRange,
    reserveFlow
  );

  // 3단계
  const us10y = await getLatestMetric(METRICS.US10Y, asOf);
  const jp10y = await getLatestMetric(METRICS.JP10Y, asOf);
  // "US10Y_JP10Y_SPREAD_BP" 전용 버킷 사용 — METRICS.US10Y_2Y10Y_SPREAD는 실제 FRED T10Y2Y(미국
  // 2Y-10Y 곡선, -1~3%p 스케일) 원자료가 매일 그대로 쌓이는 버킷이라, 스케일이 전혀 다른 US10Y-JP10Y
  // bp값(150~250 스케일)을 그 안에서 순위 매기면 사실상 항상 100%ile로 나오는 버그가 있었다.
  const spreadPercentile = us10y && jp10y
    ? await calculatePercentile("US10Y_JP10Y_SPREAD_BP", (us10y.value - jp10y.value) * 100, asOf)
    : null;
  const cftcLatest = await getLatestMetric(METRICS.CFTC_JPY_NET, asOf);
  const cftcPercentile = cftcLatest ? await calculatePercentile(METRICS.CFTC_JPY_NET, cftcLatest.value, asOf) : null;
  const jpySpike = await detectJpyVolSpike(asOf);
  const step3 = scoreStep3({
    us10y: us10y?.value ?? 0,
    jp10y: jp10y?.value ?? 0,
    spreadBpPercentile: spreadPercentile,
    cftcNetPositionPercentile: cftcPercentile,
    jpyVolSpike: jpySpike.spike,
  });
  // FRED의 미국 10년물(DGS10)은 Yahoo 주가·환율보다 발표 자체가 1영업일 더 늦다 — 같은 리포트 안에서
  // "오늘 배치가 받은 최신 주가"와 "오늘 배치가 받은 최신 국채 금리"가 서로 다른 거래일을 가리킬 수
  // 있다는 뜻이다(외부 교차검증에서 실제로 확인된 사례: 주가는 T일 종가인데 US10Y는 T-1일 값). 날짜를
  // 맞출 방법은 없으니(FRED가 그 시점에 아직 발표 전) 대신 실제 기준일을 그대로 보여줘 혼동을 막는다.
  const dateLabel = (d: Date | undefined) => (d ? d.toISOString().slice(5, 10).replace("-", "/") : null);
  // US10Y·JP10Y 둘 다 "값 옆에 실제 기준일을 표시"하므로 criterion도 같은 문구로 통일한다 — US10Y는
  // FRED 발표 지연으로 자주 하루 늦고, JP10Y(MOF)는 대체로 당일이지만 소스가 다른 이상 언제든 어긋날
  // 수 있어 똑같이 "다른 지표와 날짜가 다를 수 있다"는 일반적 주의 문구를 쓴다.
  const asOfCriterion = "참고용\n(다른 지표와 발표 기준일이 다를 수 있어 실제 기준일 표시)";
  details.step3 = [
    { label: "미국 10년물(US10Y)", criterion: asOfCriterion, value: `${fmt(us10y?.value ?? null, 2, "%")}${dateLabel(us10y?.date) ? ` (${dateLabel(us10y?.date)} 기준)` : ""}`, met: null, url: FRED_URL("DGS10") },
    { label: "일본 10년물(JP10Y)", criterion: asOfCriterion, value: `${fmt(jp10y?.value ?? null, 2, "%")}${dateLabel(jp10y?.date) ? ` (${dateLabel(jp10y?.date)} 기준)` : ""}`, met: null, url: MOF_JAPAN_URL },
    {
      // 절대구간(안정/주의/위험)은 실제 3단계 점수(scoreStep3)에는 안 쓰이고 아래 백분위 행 하나로만
      // 채점된다 — 그런데도 여기 met을 true/false로 보여주면 같은 스프레드 값을 두 행에서 두 번
      // 채점하는 것처럼 보인다. 절대구간은 "참고용 미검증 구간표"라고 criterion에도 이미 적어뒀으니
      // met은 null로 두고 설명용 라벨로만 남긴다.
      label: "US10Y-JP10Y 스프레드", criterion: "≥350bp 안정 / 250~349bp 주의 / <250bp 위험\n(미검증 참고 구간, 점수 미반영)", value: `${step3.spreadBp}bp — ${step3.zone}`, met: null,
    },
    { label: "스프레드 최근 1년 백분위", criterion: "50%ile 이상 시 충족\n(중앙값보다 넓음)", value: spreadPercentile !== null ? `${spreadPercentile}%ile` : "데이터 부족(1년 미만)", met: spreadPercentile !== null ? spreadPercentile >= 50 : null },
    {
      // 이전엔 "50%ile 미만(캐리 활발)"을 충족(met=true)으로 표시했는데, 정작 scoreStep3의 실제 점수는
      // 낮은 백분위(숏 쏠림)일수록 낮은 점수를 준다 — 캐리가 활발할수록(숏이 깊을수록) 청산 시 되돌림
      // 폭탄이 커진다는 8단계 서술과도 같은 방향이다. met을 점수·서술과 같은 방향으로 맞춘다:
      // 포지션이 정상화(50%ile 이상)돼 청산 압박이 낮을 때만 충족으로 본다.
      label: "CFTC 엔화 순포지션 백분위", criterion: "50%ile 이상 시 충족\n(숏 쏠림 완화, 청산 압박 낮음)", value: cftcPercentile !== null ? `${cftcPercentile}%ile` : "데이터 부족(1년 미만)", met: cftcPercentile !== null ? cftcPercentile >= 50 : null,
      url: CFTC_TFF_URL,
    },
    {
      label: "엔화 변동성 급등(USD/JPY 종가)",
      criterion: "일간 변동률이 최근 20일 평균 대비 2표준편차 초과 또는 1.5%p 초과",
      value: jpySpike.zScore !== null
        ? `${jpySpike.latestReturnPct}% (z=${jpySpike.zScore})`
        : "데이터 부족(21거래일 미만)",
      met: jpySpike.zScore !== null ? !jpySpike.spike : null,
      url: YAHOO_URL("JPY=X"),
    },
    {
      // 마지막 확정 종가 이후 장중 크론(USDJPY_INTRADAY)이 감지한 변동 — 다음날 09시 종가 확정을
      // 기다리지 않고 당일 캐리 청산 압박을 미리 본다. 확정 종가 이후 인트라데이 갱신이 아직
      // 없으면(장 시작 직후 등) "확인 못함"으로 둔다.
      label: "엔화 인트라데이 변동(확정 종가 대비)",
      criterion: "마지막 확정 종가 대비 ±1.5% 초과 시 경계",
      value: jpySpike.intradayReturnPct !== null ? `${jpySpike.intradayReturnPct}%` : "확인 못함",
      met: jpySpike.intradayReturnPct !== null ? Math.abs(jpySpike.intradayReturnPct) <= 1.5 : null,
      url: YAHOO_URL("JPY=X"),
    },
  ];

  details.step3Summary = summarizeStep3(step3, spreadPercentile, cftcPercentile, jpySpike);

  // 4단계 — 금·달러(USD/KRW)는 Yahoo 일별 지표라 며칠째 안 갱신되면 방향 판정 자체가 낡은 값 비교가
  // 될 수 있다. 실질금리(REAL_RATE)는 FRED 월간 지표라 이 신선도 검사 대상이 아니다.
  const gold = await freshDirection(METRICS.GOLD, asOf);
  const goldDir = gold.dir;
  const realRateDir = (await directionOf(METRICS.REAL_RATE, asOf)) ?? "flat";
  // 달러 방향은 USD/KRW가 아니라 DXY(달러 인덱스) 기준 — 원화는 한국 고유 수급 노이즈가 커서
  // 글로벌 달러 강약의 대리변수로 부적합하다(위 METRICS.DXY 주석 참고).
  const dollar = await freshDirection(METRICS.DXY, asOf);
  const dollarDir = dollar.dir;
  const step4 = scoreStep4({
    goldDirection: goldDir,
    realRateDirection: realRateDir,
    dollarDirection: dollarDir,
    us30yPercentile,
  });
  const dirLabel = (d: Direction) => (d === "up" ? "상승" : d === "down" ? "하락" : "보합");
  const staleSuffix = (daysOld: number | null, stale: boolean) =>
    !stale && daysOld !== null && daysOld >= STALE_WARN_DAYS ? ` (${daysOld}일 전 데이터)` : "";
  details.step4 = [
    {
      label: "금 가격 방향",
      criterion: "하락 시 충족\n(사분면 최고점 조합의 방향)",
      value: gold.stale ? "확인 못함" : `${dirLabel(goldDir)}${staleSuffix(gold.daysOld, gold.stale)}`,
      met: gold.stale ? null : goldDir === "down",
      url: YAHOO_URL("GC=F"),
    },
    {
      // 이전엔 여기서도 "상승 시 충족"으로 met을 매겼는데, 2단계에 이미 "실질금리 3기간 연속 하락(또는
      // 낮은 데서 횡보) 시 충족"이라는 반대 부호의 단독 판정이 있다 — 같은 실질금리 방향이 리포트
      // 안에서 두 번, 서로 반대로 채점되는 셈이다(하락=2단계 충족, 상승=4단계 충족). 실질금리 단독
      // 평가는 2단계에만 남기고, 여기서는 사분면(quadrant) 조합을 구성하는 참고 정보로만 보여준다.
      label: "실질금리 방향", criterion: "참고용\n(사분면 조합의 한 축 — 단독 충족/미충족 판정은 2단계에서)", value: dirLabel(realRateDir), met: null,
      url: FRED_URL("REAINTRATREARAT10Y"),
    },
    {
      label: "달러 방향(DXY)",
      criterion: "보조 확인\n(실질금리와 같은 방향이면 신호 강함)",
      value: dollar.stale ? "확인 못함" : `${dirLabel(dollarDir)}${staleSuffix(dollar.daysOld, dollar.stale)}`,
      met: dollar.stale ? null : step4.dollarConfirms,
      url: YAHOO_URL("DX-Y.NYB"),
    },
    { label: "사분면 판정", criterion: "위험선호 우호적 조합 시 충족\n(금↓/보합+실질금리↑ 또는 금↑+실질금리↓/보합)", value: `${step4.quadrant} — 점수 ${step4.score}/10`, met: step4.score >= 5 },
  ];

  // 보조 지표 — 환율(USD/KRW, USD/JPY)·유가(WTI, 브렌트)의 전일 대비 변동. 원본 프롬프트의 4개 핵심 지표
  // 구조를 그대로 유지하려고 집계엔 안 넣고, 2단계와 같은 방식으로 별도 토글("보조 지표 보기")로 뺀다.
  const usdKrwChange = await dailyChange(METRICS.USDKRW, asOf);
  const usdJpyChange = await dailyChange(METRICS.USDJPY, asOf);
  const kospiChange = await dailyChange(METRICS.KOSPI, asOf);
  const wtiChange = await dailyChange(METRICS.WTI, asOf);
  const brentChange = await dailyChange(METRICS.BRENT, asOf);
  const wtiDir = (await directionOf(METRICS.WTI, asOf)) ?? "flat";

  // 외국인 순매수(코스피): 한국투자증권 Open API. USD/KRW 변동의 원인 참고용이라 USD/KRW 바로
  // 옆에 둔다 — 5거래일치가 다 쌓여야 "5거래일 누적"이 의미 있어 부족하면 확인 못함으로 남긴다.
  const foreignNetBuyHistory = await getMetricHistoryByCount(METRICS.FOREIGN_NET_BUY_KOSPI, 5, asOf);
  const foreignNetBuy5dEok =
    foreignNetBuyHistory.length === 5
      ? foreignNetBuyHistory.reduce((sum, h) => sum + h.value, 0) / 100 // 백만원 -> 억원
      : null;

  details.step4Aux = [
    { label: "USD·KRW", criterion: "한국 투자자 관점 보조 지표\n(한국 고유 수급 영향 커서 달러 방향 판정엔 DXY를 씀)", value: fmtDailyChange(usdKrwChange, "원"), met: null, url: YAHOO_URL("KRW=X") },
    {
      label: "외국인 순매수(코스피)",
      criterion: "5거래일 누적 순매수 — USD/KRW 변동의 원인 참고용",
      value: foreignNetBuy5dEok !== null
        ? `${fmt(Math.abs(foreignNetBuy5dEok), 0, "억원")} — ${foreignNetBuy5dEok >= 0 ? "순매수" : "순매도"}`
        : "확인 못함",
      met: null,
    },
    { label: "USD·JPY", criterion: "강달러(상승)면 Risk-Off 쪽 신호", value: fmtDailyChange(usdJpyChange, "엔"), met: null, url: YAHOO_URL("JPY=X") },
    { label: "코스피", criterion: "한국 투자자 관점 보조 지표(전일 대비 변동만 참고용)", value: fmtDailyChange(kospiChange, "포인트"), met: null, url: YAHOO_URL("^KS11") },
    { label: "WTI유 선물", criterion: "고유가(상승)면 Risk-Off 쪽 신호", value: fmtDailyChange(wtiChange, "달러"), met: null, url: YAHOO_URL("CL=F") },
    { label: "브렌트유 선물", criterion: "고유가(상승)면 Risk-Off 쪽 신호", value: fmtDailyChange(brentChange, "달러"), met: null, url: YAHOO_URL("BZ=F") },
  ];

  details.step4Summary = summarizeStep4(
    step4,
    { dollarDir, oilDir: wtiDir, oilChangePct: wtiChange.changePct, brentChangePct: brentChange.changePct },
    {
      overseasQualifyingCount: step2.overseasQualifyingCount,
      overseasTotalCount: step2.overseasTotalCount,
      carryZone: step3.zone,
      jpySpike: jpySpike.spike,
    }
  );

  // 5단계
  const ndxReturn20d = (await calculateCumulativeReturn(METRICS.NDX, 20, asOf)) ?? 0;
  const rutReturn20d = (await calculateCumulativeReturn(METRICS.RUT, 20, asOf)) ?? 0;
  const djiReturn20d = (await calculateCumulativeReturn(METRICS.DJI, 20, asOf)) ?? 0;
  const spxReturn20d = (await calculateCumulativeReturn(METRICS.SPX, 20, asOf)) ?? 0;
  const btcReturn20d = await calculateCumulativeReturn(METRICS.BTC, 20, asOf);
  const ethReturn20d = await calculateCumulativeReturn(METRICS.ETH, 20, asOf);
  const gapPercentile = await calculatePercentile("NDX_RUT_GAP", ndxReturn20d - rutReturn20d, asOf);
  const step5 = scoreStep5({
    ndxReturn20d, rutReturn20d, gapPercentile, djiReturn20d, spxReturn20d, btcReturn20d, ethReturn20d,
  });

  // 마감가·전일 대비 변동폭·등락률 — 나스닥 카페 "매크로 환경 및 주요 지수 마감 동향" 형식 참고.
  const ndxChange = await dailyChange(METRICS.NDX, asOf);
  const rutChange = await dailyChange(METRICS.RUT, asOf);
  const djiChange = await dailyChange(METRICS.DJI, asOf);
  const spxChange = await dailyChange(METRICS.SPX, asOf);
  const btcChange = await dailyChange(METRICS.BTC, asOf);
  const ethChange = await dailyChange(METRICS.ETH, asOf);

  const concentrationResult = step5.concentrationWarning
    ? step5.gapPp > 0
      ? "대형 기술주 쏠림 심화"
      : "중소형주 쏠림 심화"
    : "기술주·중소형주 균형적 순환매";
  const cryptoResult = step5.cryptoAlignsWithRisk === null
    ? "확인 못함"
    : step5.cryptoAlignsWithRisk
      ? "나스닥과 동조"
      : "나스닥과 괴리";

  // 첫 번째 표 — vs 비교 지표 2개 + 암호화폐 동조 분석. 단순 충족/불충족이 아니라
  // 범주형 판정이라 met 대신 result(텍스트)로 결과열을 채운다.
  details.step5 = [
    {
      label: "나스닥100 vs 러셀2000 (자금 쏠림)",
      criterion: "20거래일 수익률 격차 3%p 초과 시 쏠림 경계",
      value: `나스닥100 ${fmt(ndxReturn20d, 2, "%")} / 러셀2000 ${fmt(rutReturn20d, 2, "%")} — 격차 ${step5.gapPp.toFixed(2)}%p(${gapPercentile !== null ? `${gapPercentile}%ile` : "데이터 부족"})`,
      met: null,
      result: concentrationResult,
    },
    {
      label: "다우존스 vs S&P500 (위험선호)",
      criterion: "SPX 우세=위험선호\nDJI 우세=안전선호\n동률=중립",
      value: `다우존스 ${fmt(djiReturn20d, 2, "%")} / S&P500 ${fmt(spxReturn20d, 2, "%")} — (20거래일)`,
      met: null,
      result: step5.riskAppetite,
    },
    {
      label: "암호화폐 동조 분석",
      criterion: "나스닥과 같은 방향이면 위험선호 동조\n다르면 코인 고유 이슈 가능",
      value: `비트코인 ${fmt(btcReturn20d, 2, "%")} / 이더리움 ${fmt(ethReturn20d, 2, "%")} — (20거래일)`,
      met: null,
      result: cryptoResult,
    },
  ];

  // 두 번째 표 — 4대 지수 + 암호화폐 2종의 마감가·전일 대비 변동 원자료. 집계엔 안 들어가는 참고용이라
  // 충족열 없이 실제값만 나열한다(StepCard의 auxHideMetColumn).
  details.step5Aux = [
    { label: "나스닥100(NDX)", criterion: "마감가 · 전일 대비 변동", value: fmtDailyChange(ndxChange, "포인트"), met: null },
    { label: "러셀2000(RUT)", criterion: "마감가 · 전일 대비 변동", value: fmtDailyChange(rutChange, "포인트"), met: null },
    { label: "다우존스(DJI)", criterion: "마감가 · 전일 대비 변동", value: fmtDailyChange(djiChange, "포인트"), met: null },
    { label: "S&P500(SPX)", criterion: "마감가 · 전일 대비 변동", value: fmtDailyChange(spxChange, "포인트"), met: null },
    { label: "비트코인(BTC)", criterion: "마감가 · 전일 대비 변동", value: fmtDailyChange(btcChange, "달러"), met: null },
    { label: "이더리움(ETH)", criterion: "마감가 · 전일 대비 변동", value: fmtDailyChange(ethChange, "달러"), met: null },
  ];

  // 빅테크 7(Magnificent 7) 개별 종목 마감가·전일 대비 변동·등락 원인 — 나스닥100 쏠림 신호를
  // 실제로 이끄는 종목이 뭔지 드릴다운하는 참고용이라 충족열은 없다. 종합판단에서 가장 크게 움직인
  // 종목을 짚어줄 수 있도록 summarizeStep5보다 먼저 계산해둔다.
  const bigTechChanges = await Promise.all(BIG_TECH_TICKERS.map((ticker) => dailyChange(ticker, asOf)));
  const bigTechReasons = manualInputs.bigTechReasons ?? {};
  const reasonFor = (ticker: string) => bigTechReasons[ticker] ?? "명확한 원인 확인 안 됨";
  const bigTechMovers = BIG_TECH_TICKERS.map((ticker, i) => ({
    ticker, label: BIG_TECH_LABELS[ticker], change: bigTechChanges[i], reason: reasonFor(ticker),
  }));
  const topBigTechMover = bigTechMovers.reduce<typeof bigTechMovers[number] | null>((top, m) => {
    if (m.change.changePct === null) return top;
    if (!top || top.change.changePct === null) return m;
    return Math.abs(m.change.changePct) > Math.abs(top.change.changePct) ? m : top;
  }, null);

  details.step5Summary = summarizeStep5(step5, ndxReturn20d, rutReturn20d, djiReturn20d, spxReturn20d, gapPercentile, topBigTechMover);

  details.step5BigTech = bigTechMovers.map(({ ticker, label, change, reason }) => ({
    label: `${label}(${ticker})`,
    criterion: "마감가 · 전일 대비 변동 · 원인",
    value: `${fmtDailyChange(change, "달러")} — ${reason}`,
    met: null,
  }));

  // 6단계 — 섹터는 시계열로 저장하지 않고 매번 라이브로만 조회해서(볼륨까지 필요해 MetricValue
  // 스키마와 안 맞음) "N일 전 데이터" 폴백은 구조적으로 불가능하다. 대신 3·4·5·7단계와 같은 원칙으로,
  // 일부 섹터만 조회 실패해도 조용히 빠뜨리지 않고 그 섹터만 이름을 남겨 확인 못함으로 명시한다
  // (기존엔 fetchAllSectors가 실패분을 필터링해 사라져서, 몇 개가 빠졌는지 알 길이 없었다).
  const step6 = scoreStep6({ sectors: manualInputs.sectors });
  const qualifyingSet = new Set(step6.qualifying);
  const missingSectorLabels = manualInputs.missingSectorLabels ?? [];
  details.step6 =
    manualInputs.sectors.length === 0 && missingSectorLabels.length === 0
      ? [{ label: "섹터 데이터", criterion: "-", value: "확인 못함", met: null }]
      : [
          ...manualInputs.sectors.map((s) => {
            const qualifying = qualifyingSet.has(s.name);
            const dailyPart = s.changePct1d !== undefined ? ` · 1일 ${fmt(s.changePct1d, 2, "%")}` : "";
            return {
              label: s.name,
              criterion: "5일 수익률 상위 3위 이내\n+ 거래량 20일 평균 대비 130%+",
              value: `5일 ${fmt(s.return5d, 2, "%")}${dailyPart} · 거래량 ${s.volumeRatio.toFixed(2)}배 — ${sectorRationale(qualifying, s.return5d, s.volumeRatio)}`,
              met: qualifying,
            };
          }),
          ...missingSectorLabels.map((label) => ({
            label,
            criterion: "5일 수익률 상위 3위 이내\n+ 거래량 20일 평균 대비 130%+",
            value: "확인 못함",
            met: null,
          })),
        ];
  details.step6Summary = summarizeStep6(step6, manualInputs.sectors);

  // 7단계
  const vixRow = await getLatestMetric(METRICS.VIX, asOf);
  const vixDaysOld = vixRow ? daysBetween(asOf, vixRow.date) : null;
  const vixStale = vixDaysOld !== null && vixDaysOld >= STALE_UNKNOWN_DAYS;
  const vix = vixStale ? null : (vixRow?.value ?? null);
  const vixStaleNote = !vixStale && vixDaysOld !== null && vixDaysOld >= STALE_WARN_DAYS ? ` (${vixDaysOld}일 전 데이터)` : "";
  const fearGreedMetric = await getLatestMetric(METRICS.CNN_FEAR_GREED, asOf);
  const fearGreed = fearGreedMetric?.value ?? null;
  const step7 = scoreStep7({ vix, fearGreed });

  // 기관·내부자 매집 신호(Dataroma·OpenInsider) — 5·6단계에서 이미 나온 종목·섹터와 일치하는지 대조.
  // 매칭은 여기서(run.ts) 한다: institutional-signals.ts는 외부 소스만 다루고, 5·6단계 결과는
  // run.ts에서만 알 수 있기 때문(bigTechReasons의 topBigTechMover 선정과 같은 원칙).
  // 섹터 일치와 티커 일치는 서로 다른 근거라 하나로 뭉뚱그리지 않는다 — "금융 섹터로 몰렸는데
  // 실제로는 티커 하나만 겹쳐서 일치 판정"처럼 표시가 근거와 안 맞는 걸 막기 위함.
  const institutional = manualInputs.institutionalSignals;
  const tickerMatch = institutional?.activityTickers.find((t) => (BIG_TECH_TICKERS as readonly string[]).includes(t)) ?? null;
  const sectorMatch =
    institutional?.topSectorLabel && step6.qualifying.includes(institutional.topSectorLabel)
      ? institutional.topSectorLabel
      : null;

  let institutionalMatch: string;
  if (!institutional) {
    institutionalMatch = "확인 안 됨";
  } else if (sectorMatch && tickerMatch) {
    institutionalMatch = `일치(섹터 ${sectorMatch}, 종목 ${tickerMatch})`;
  } else if (sectorMatch) {
    institutionalMatch = `일치(섹터 ${sectorMatch})`;
  } else if (tickerMatch) {
    institutionalMatch = `일치(종목 ${tickerMatch}) — 섹터는 불일치(${institutional.topSectorLabel ?? "확인 못함"})`;
  } else if (institutional.topSectorLabel || institutional.activityTickers.length > 0) {
    institutionalMatch = `불일치 — 실제 매집: ${institutional.topSectorLabel ?? institutional.activityTickers[0]}`;
  } else {
    institutionalMatch = "확인 안 됨";
  }

  // 표를 2개로 나눈다 — ①기관·내부자 매집(신규, 충족열 없음, 바로가기 열 있음) ②공포탐욕·VIX 지수(기존, 충족열 유지).
  details.step7Institutional = [
    { label: "슈퍼 투자자 포트폴리오", criterion: "고래/헤지펀드 매매 내역", value: institutional?.superInvestorSummary ?? "확인 못함", met: null, url: DATAROMA_URL },
    { label: "종목별 기관 지분 분석", criterion: "종목 중심의 스마트머니 추적", value: institutional?.stockConsensusSummary ?? "확인 못함", met: null, url: DATAROMA_URL },
    { label: "섹터 및 자금 흐름", criterion: "자금 유입/유출 동향", value: institutional?.sectorFlowSummary ?? "확인 못함", met: null, url: DATAROMA_URL },
    { label: "내부자 거래", criterion: "기업 임원/대주주 매매 기록", value: institutional?.insiderTradeSummary ?? "확인 못함", met: null, url: OPENINSIDER_URL },
    {
      label: "빅테크 공매도 거래비중(FINRA)",
      criterion: "거래대금 중 공매도 비율, T+1 지연 — 대형주는 마켓메이커 유동성공급 때문에 40~50%대가 정상 범위(방향성 약세 신호 아님)",
      value: institutional?.shortVolumeSummary ?? "확인 못함",
      met: null,
      url: FINRA_SHORT_VOLUME_URL,
    },
    {
      label: "국내 지분공시(DART)",
      criterion: "대량보유·임원소유 변동, 당일",
      value: institutional?.domesticFilingSummary ?? "확인 못함",
      met: null,
      url: DART_EQUITY_URL,
    },
    {
      label: "KOSPI 공매도 잔고비중(KRX)",
      criterion: "시가총액가중 평균, T+2 지연",
      value: manualInputs.krxShortBalance
        ? `${manualInputs.krxShortBalance.ratio.toFixed(2)}%(${manualInputs.krxShortBalance.date} 기준)`
        : "확인 못함",
      met: null,
      url: KRX_SHORT_URL,
    },
    { label: "전단계 섹터·종목과 일치 여부", criterion: "5·6단계 분석과 비교", value: institutionalMatch, met: null },
  ];
  details.step7 = [
    {
      label: "VIX",
      criterion: [nbsp(`${VIX_OVERHEAT_BELOW} 미만 과열`), nbsp(`${VIX_FEAR_ABOVE} 초과 공포`)].join("\n"),
      value: vix === null ? "확인 못함" : `${fmt(vix, 2)}${vixStaleNote}`,
      met: vix === null ? null : vix >= VIX_OVERHEAT_BELOW && vix <= VIX_FEAR_ABOVE,
    },
    {
      label: "CNN 공포와 탐욕지수",
      criterion: [
        nbsp("0~24 극단적공포"),
        nbsp("25~44 공포"),
        nbsp("45~55 중립"),
        nbsp("56~75 탐욕"),
        nbsp("76~100 극단적탐욕"),
      ].join("\n"),
      value: fearGreed !== null ? `${fearGreed.toFixed(1)}(${cnnFearGreedRating(fearGreed)})` : "확인 못함",
      met: fearGreed === null ? null : fearGreed >= FEAR_GREED_EXTREME_FEAR_BELOW && fearGreed <= FEAR_GREED_EXTREME_GREED_ABOVE,
    },
    {
      label: "Put/Call 비율(SPY)",
      criterion: "1.0 위=풋 우위(공포), 아래=콜 우위(탐욕) — 참고용, 임계값 미검증이라 미채점",
      value: manualInputs.putCallRatio != null ? manualInputs.putCallRatio.toFixed(2) : "확인 못함",
      met: null,
    },
    { label: "양쪽 동시 과열", criterion: "매수 크기 30% 축소", value: step7.bothOverheated ? "예" : "아니오", met: !step7.bothOverheated },
    // "공포 구간"은 위 행과 달리 페널티가 없다 — "예"는 경고가 아니라 역발상 매수 기회 참고용 신호라
    // 좋다/나쁘다로 판정할 대상이 아니다(공포=매수 기회라는 원칙과 met:false가 모순되면 안 됨).
    // 라벨을 "극단적 공포/VIX 급등"으로 바꿔서 위 행의 CNN 5단계 등급명("공포", 25~44)과 여기서 쓰는
    // 더 좁은 기준(공포탐욕<25 또는 VIX>25)이 같은 단어를 다르게 쓰는 것처럼 보이던 문제를 없앤다 —
    // 외부 교차검증에서 "32.3=공포(위 행)인데 이 배지는 아니오"라며 자기모순으로 지적된 부분.
    { label: "극단적 공포/VIX 급등", criterion: "공포탐욕<25 또는 VIX>25 시 역발상 매수 기회 고려", value: step7.fearZone ? "예" : "아니오", met: null },
  ];
  details.step7Summary = summarizeStep7(institutional, sectorMatch, tickerMatch, vix, fearGreed, step7);

  // 8단계
  const step8 = scoreStep8({ step1, step2, step3, step4, step5, step6, step7 });
  details.step8 = [
    { label: `2단계 유동성 (가중치 ${WEIGHTS.step2})`, criterion: "가중 반영", value: `${step2.finalScore.toFixed(2)} × ${WEIGHTS.step2} = ${(step2.finalScore * WEIGHTS.step2).toFixed(2)}`, met: null },
    { label: `3단계 캐리 트레이드 (가중치 ${WEIGHTS.step3})`, criterion: "가중 반영", value: `${step3.score.toFixed(2)} × ${WEIGHTS.step3} = ${(step3.score * WEIGHTS.step3).toFixed(2)}`, met: null },
    { label: `4단계 환율·금·유가 (가중치 ${WEIGHTS.step4})`, criterion: "가중 반영", value: `${step4.score.toFixed(2)} × ${WEIGHTS.step4} = ${(step4.score * WEIGHTS.step4).toFixed(2)}`, met: null },
    { label: `5단계 자금 도착 (가중치 ${WEIGHTS.step5})`, criterion: "가중 반영", value: `${step5.score.toFixed(2)} × ${WEIGHTS.step5} = ${(step5.score * WEIGHTS.step5).toFixed(2)}`, met: null },
    { label: `6단계 섹터 (가중치 ${WEIGHTS.step6})`, criterion: "가중 반영", value: `${step6.score.toFixed(2)} × ${WEIGHTS.step6} = ${(step6.score * WEIGHTS.step6).toFixed(2)}`, met: null },
    // 페이지 다른 곳(ScoreBadge, forwardSignals.scoreToWatchMargin 등)은 전부 소수점 둘째 자리까지만
    // 보여주는데 여기만 셋째 자리("2.951")까지 보여줘 근거 없는 허위 정밀도로 보인다는 지적이 있었다
    // (외부 감사 지적) — 계산 자체(가중합/7.5)는 그대로 두고 표시만 둘째 자리로 맞춘다.
    { label: "투자 적합도 점수", criterion: `가중합 / ${TOTAL_WEIGHT}`, value: step8.macroTrendScore.toFixed(2), met: null },
    { label: "1단계 거부권 적용", criterion: "발동 시 한 단계 하향", value: step8.vetoApplied ? "적용됨" : "미적용", met: !step8.vetoApplied },
    { label: "최종 결론", criterion: "≥7.0 매수\n≥5.0 지켜보기\n미만 현금비중늘리기", value: step8.finalDecision, met: null },
  ];

  // forwardSignals — 종합 보고서 "앞으로 자본이 이동할 곳" 문단 전용 재료(StepDetails 타입 주석 참고).
  const upcomingEventsRow = details.step1.find((r) => r.label === "14일 내 예정된 이벤트");
  const institutionalFlowRow = details.step7Institutional?.find((r) => r.label === "섹터 및 자금 흐름");
  details.forwardSignals = {
    liquidityCycle: {
      netLiquidityDirection: netLiq.risingTrend === null ? "확인 못함" : netLiq.risingTrend ? "상승" : "하락",
      rrpBuffer: rrpStatus?.depleted ? "고갈(충격 흡수 여력 없음)" : "여유 있음",
      creditSpreadBp,
      creditLeadsEquity:
        creditSpreadBp !== null && creditSpreadBp < CREDIT_SPREAD_TIGHT_BP
          ? "스프레드가 역사적 저점권이라 추가 축소 여력은 작고, 확대 전환 시 주식이 뒤따를 위험"
          : "스프레드가 정상 구간 — 추가 확대 여부가 다음 관문",
    },
    upcomingEvents: upcomingEventsRow && upcomingEventsRow.value !== "없음" ? upcomingEventsRow.value : null,
    // 예전엔 이 두 문장이 "현재 사분면이 금↓실질금리↑"라고 가정한 고정 텍스트였다 — 실제 현재 사분면이
    // 그게 아닐 때(예: 금↑실질금리↑)도 항상 같은 문구가 나가서 LLM이 앞뒤를 맞추려다 존재하지 않는
    // "1/10" 점수를 지어내고 방향까지 거꾸로 서술한 사례가 실제로 있었다(외부 감사 지적). 반대 방향
    // 축을 실제로 뒤집어 scoreStep4를 다시 돌려서, 어떤 사분면에서 시작하든 항상 실제 도착 사분면·
    // 점수를 정확히 계산해 넣는다.
    quadrantExit: {
      current: `${step4.quadrant} — 점수 ${step4.score}/10`,
      ifGoldFlips: describeQuadrantFlip("gold", goldDir, realRateDir, dollarDir, us30yPercentile),
      ifRateFlips: describeQuadrantFlip("rate", goldDir, realRateDir, dollarDir, us30yPercentile),
    },
    // 사분면 점수를 임의로 만들어내지 못하게 기본 점수표(텀프리미엄 조정 전)를 그대로 실어 보낸다 —
    // 프롬프트에서 "이 표에 없는 사분면 점수는 언급하지 마라"고 강제한다.
    quadrantScoreTable: {
      "금↑ 실질금리↑": 2,
      "금↑ 실질금리↓/보합": 5,
      "금↓/보합 실질금리↑": 10,
      "금↓/보합 실질금리↓/보합": 3,
    },
    distanceToThresholds: {
      // 예전엔 raw bp 숫자만 줘서 LLM이 "현재값 대비 목표까지 거리"를 스스로 계산하다 틀리는 사례가
      // 있었다(예: 168bp 남은 걸 168bp를 목표치로 오인) — 문장으로 미리 완성해 옮겨적기만 하면 되게
      // 한다(JPY_VOL_NOTE와 같은 원칙: 판단·계산을 LLM에 맡기지 않는다).
      carrySafeMargin: `현재 ${step3.spreadBp}bp, 안전 마진 350bp까지 ${(350 - step3.spreadBp).toFixed(0)}bp 남음`,
      vixFearMargin: vix !== null ? `현재 ${vix.toFixed(2)}, 공포 구간 ${VIX_FEAR_ABOVE}까지 ${(VIX_FEAR_ABOVE - vix).toFixed(2)}pt 남음` : "확인 못함",
      creditNormalMargin:
        creditSpreadBp !== null
          ? `현재 ${creditSpreadBp}bp, 정상 수준 ${CREDIT_SPREAD_TIGHT_BP}bp까지 ${(CREDIT_SPREAD_TIGHT_BP - creditSpreadBp).toFixed(0)}bp 남음`
          : "확인 못함",
      scoreToWatchMargin: `현재 ${step8.macroTrendScore.toFixed(2)}점, 지켜보기 기준 5.0점까지 ${(5.0 - step8.macroTrendScore).toFixed(2)}점 모자람`,
    },
    institutionalDirection: institutionalFlowRow?.value ?? null,
  };

  details.pptSlides = buildPptSlides({
    step1, step2, step3, step4, step5, step6, step7, step8,
    step2Summary: details.step2Summary ?? "",
    step3Summary: details.step3Summary ?? "",
    step4Summary: details.step4Summary ?? "",
    step5Summary: details.step5Summary ?? "",
    step6Summary: details.step6Summary ?? "",
    step7Summary: details.step7Summary ?? "",
    vix,
    fearGreed,
    sectors: manualInputs.sectors,
    bigTechMovers: bigTechMovers.map((m) => ({ ticker: m.ticker, label: m.label, changePct: m.change.changePct, reason: m.reason })),
  });

  return { step1, step2, step3, step4, step5, step6, step7, step8, details };
}

// 참고: SECTOR_ETFS는 6단계 수동 입력을 만들 때 어떤 티커를 조회해야 하는지 알려주는 상수.
// EODHD 연동(6번 과제) 완료 전까지는 sectors 배열을 호출부에서 직접 채워 넣어야 한다.
export { SECTOR_ETFS };
export type { StepDetailRow, StepDetails };
