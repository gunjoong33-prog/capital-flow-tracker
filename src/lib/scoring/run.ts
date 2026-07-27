import { getLatestMetric, getMetricHistory, getMetricHistoryByCount, calculatePercentile, calculateCumulativeReturn } from "@/lib/metrics";
import { getRecentRiskyNews } from "@/lib/news-events";
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
} from "./pure";
import type { Direction, SectorInput, Step5Result, StepDetailRow, StepDetails } from "./types";

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

/** 한글 명사 뒤에 "로/으로" 조사를 받침 유무에 맞게 붙인다(7단계 종합판단 등 문장 생성용). */
function attachRo(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}로`;
  const hasBatchim = (last - 0xac00) % 28 !== 0;
  return `${word}${hasBatchim ? "으로" : "로"}`;
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
  fxOilDirection: { dollarDir: Direction; oilDir: Direction },
  context: {
    vetoTriggered: boolean;
    overseasQualifyingCount: number;
    overseasTotalCount: number;
    carryZone: string;
    jpySpike: boolean;
  }
): string {
  const lines: string[] = [];
  lines.push(`현재 사분면은 "${step4Result.quadrant}"입니다(4단계 점수 ${step4Result.score}/10).`);
  lines.push(...splitSentences(step4Result.note.endsWith(".") ? step4Result.note : `${step4Result.note}.`));
  lines.push(
    step4Result.dollarConfirms
      ? "달러도 실질금리와 같은 방향으로 움직이고 있어 신호가 강한 편입니다."
      : "달러는 실질금리와 다른 방향으로 움직이고 있어 디커플링(신호 약화) 경계가 필요합니다."
  );

  const riskStance = fxOilDirection.dollarDir === "up" && fxOilDirection.oilDir === "up"
    ? "Risk-Off(자본이 미국에 갇힘)"
    : fxOilDirection.dollarDir === "down"
      ? "Risk-On(신흥국으로 자금 확산)"
      : "혼조";

  let reason: string;
  if (context.vetoTriggered) {
    reason = "1단계에서 지정학적·정책 리스크로 거부권이 발동된 만큼 안전자산 선호가 영향을 준 것으로 보입니다.";
  } else if (context.jpySpike || context.carryZone === "위험") {
    reason = "3단계 엔 캐리 트레이드 청산 압박(스프레드 위험 구간 또는 엔화 변동성 급등)이 환시 변동성을 키운 것으로 보입니다.";
  } else if (context.overseasTotalCount > 0 && context.overseasQualifyingCount / context.overseasTotalCount < 3 / 7) {
    reason = "2단계 해외 유동성이 위축된 국면이라 위험자산 대비 달러 선호가 반영된 것으로 보입니다.";
  } else {
    reason = "1~3단계에서 뚜렷한 리스크 신호는 없어 통상적인 변동 범위 안에서 움직인 것으로 보입니다.";
  }
  lines.push(`환율·유가는 ${riskStance} 흐름입니다.`);
  lines.push(reason);

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

  const concentrationDesc = step5Result.concentrationWarning
    ? step5Result.gapPp > 0
      ? "대형 기술주(나스닥100) 쪽으로 자금이 쏠리는 집중 장세"
      : "중소형주(러셀2000) 쪽으로 자금이 쏠리는 구간"
    : "나스닥100·러셀2000이 비슷하게 움직이는 건강한 순환매";
  lines.push(
    `나스닥100 ${ndxReturn20d.toFixed(2)}% / 러셀2000 ${rutReturn20d.toFixed(2)}%(20거래일)로 격차 ${step5Result.gapPp.toFixed(2)}%p — ${concentrationDesc}입니다.`
  );
  if (gapPercentile !== null) {
    lines.push(`이 격차는 최근 1년 중 ${gapPercentile}%ile 수준입니다.`);
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

  // 나스닥100 쏠림·순환매 판정이 실제로 어느 종목에서 나오는지 짚어준다 — 원인은 Gemini가 뉴스
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
    let matchDesc: string;
    if (sectorMatch) {
      matchDesc = "6단계에서 짚은 충족 섹터와 일치해 신호가 서로 보강됩니다.";
    } else if (tickerMatch) {
      matchDesc = `섹터 자체는 6단계 충족 섹터와 다르지만, ${tickerMatch}은(는) 5단계 빅테크 매수와 겹쳐 부분적으로 참고할 만합니다.`;
    } else if (institutional.topSectorLabel || institutional.activityTickers.length > 0) {
      matchDesc = "5·6단계 분석과는 다른 흐름이라 참고 자료로만 활용하는 게 좋습니다.";
    } else {
      matchDesc = "비교할 만큼 데이터가 충분하지 않습니다.";
    }
    lines.push(`슈퍼 투자자·내부자 자금은 최근 ${attachRo(flowDesc)} 몰렸고, ${matchDesc}`);
  } else {
    lines.push("기관·내부자 매집 데이터를 확인하지 못했습니다.");
  }

  const vixDesc = vix === null
    ? "VIX 데이터 없음"
    : vix < 15
      ? `VIX ${vix.toFixed(2)}(과열 구간, 15 미만)`
      : vix > 25
        ? `VIX ${vix.toFixed(2)}(공포 구간, 25 초과)`
        : `VIX ${vix.toFixed(2)}(중립)`;
  const fgDesc =
    fearGreed === null
      ? "공포탐욕지수 확인 못함"
      : `공포탐욕지수 ${fearGreed.toFixed(1)}(${cnnFearGreedRating(fearGreed)}, CNN 기준)`;
  const implication = step7Result.bothOverheated
    ? "양쪽 다 과열 신호라 추가 자금 유입 여력은 줄고 단기 조정 위험이 커진 상태입니다."
    : step7Result.fearZone
      ? "공포 신호가 감지돼 역발상 매수 기회일 수 있지만, 추가 자금 이탈 위험도 함께 살펴야 합니다."
      : "둘 다 극단적이지 않아 자본 유출입에 특별한 경고 신호는 없습니다.";
  lines.push(`${vixDesc}, ${fgDesc} — ${implication}`);

  return lines.join("\n");
}

interface DailyChange {
  latest: number | null;
  changeAmount: number | null;
  changePct: number | null;
  source: string | null; // "yahoo" | "fred" 등 — fred면 Yahoo가 실패해 폴백된 값이라는 뜻
  daysOld: number | null; // 최신값의 날짜가 오늘로부터 며칠 전인지
}

/**
 * 지표의 최신값과 직전 데이터포인트 대비 변동액·변동률. 4단계 환율·유가 보조 지표에 쓴다.
 * USD/KRW·USD/JPY·WTI·브렌트는 평소 Yahoo(당일 종가)가 채우고, Yahoo가 실패한 날에만
 * FRED(연준·EIA 공식 소스, 2~3영업일 지연)로 자동 대체된다 — source로 어느 쪽인지 구분한다.
 */
async function dailyChange(metric: string): Promise<DailyChange> {
  const [prev, curr] = await getMetricHistoryByCount(metric, 2);
  if (!curr) return { latest: null, changeAmount: null, changePct: null, source: null, daysOld: null };
  const daysOld = Math.round((Date.now() - curr.date.getTime()) / (1000 * 60 * 60 * 24));
  if (!prev) return { latest: curr.value, changeAmount: null, changePct: null, source: curr.source, daysOld };
  const changeAmount = curr.value - prev.value;
  const changePct = prev.value !== 0 ? (changeAmount / prev.value) * 100 : null;
  return { latest: curr.value, changeAmount, changePct, source: curr.source, daysOld };
}

/** dailyChange 결과를 "값 (단위) — 전일 대비 ±값 (단위), ±값%" 형태의 표시 문자열로 만든다. */
function fmtDailyChange(c: DailyChange, unit: string, decimals = 2): string {
  if (c.latest === null) return "확인 못함";
  const latestStr = fmt(c.latest, decimals, unit);
  // Yahoo가 실패해 FRED로 대체된 값이면, 며칠 전 값인지 명시해서 "당일 값"으로 오해하지 않게 한다.
  const fallbackNote = c.source === "fred" ? ` (FRED 대체, ${c.daysOld}일 전)` : "";
  if (c.changeAmount === null || c.changePct === null) return `${latestStr}${fallbackNote}`;
  const sign = c.changeAmount >= 0 ? "+" : "";
  return `${latestStr}${fallbackNote} — 전일 대비 ${sign}${comma(c.changeAmount, decimals)} (${unit}), ${sign}${c.changePct.toFixed(2)}%`;
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
  sectors: SectorInput[];
  bigTechReasons?: Record<string, string>;
  institutionalSignals?: InstitutionalSignals;
}) {
  const details = {} as StepDetails;

  // 1단계 — 거부권은 "뉴스 3건 이상" 또는 "최근 발표된 FOMC/CPI/고용지표 결과가 서프라이즈"일 때 발동.
  // (예정된 이벤트가 있다는 것만으로 발동하면 FOMC·CPI·고용지표를 합쳐 거의 매일 걸려서 거부권이 상시 발동해버림 —
  // 그래서 "예정" 여부가 아니라 "지난 발표의 실제 결과"로 기준을 바꿨다. 예정 목록은 정보용으로만 따로 보여준다.)
  const riskyNews = await getRecentRiskyNews(7);
  const upcomingEvents = await getUpcomingMajorEvents(14);
  const recentOutcomes = await evaluateRecentEventOutcomes(5);
  const hasEventSurprise = recentOutcomes.some((o) => o.risky);
  const hasSevereNews = riskyNews.some((n) => n.severity === "high");
  const step1 = {
    ...scoreStep1({
      newsCountLast7Days: riskyNews.length,
      hasRecentEventSurprise: hasEventSurprise,
      hasSevereNewsInWindow: hasSevereNews,
    }),
    riskyNews: riskyNews.map((n) => ({
      title: n.title, url: n.url, summary: n.summary, date: n.date.toISOString().slice(0, 10),
      severity: n.severity === "high" ? "high" as const : "normal" as const,
    })),
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
    {
      label: "단독 즉시발동 수준(심각도 high) 뉴스",
      criterion: "없음",
      value: hasSevereNews ? "있음" : "없음",
      met: !hasSevereNews,
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
        ? upcomingEvents.map((e) => `${e.name}(${e.date.toISOString().slice(0, 10)})`).join("\n")
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

  const step2 = scoreStep2({
    walclIncreasing: walcl.met,
    m2GrowthRising2Months: m2.met,
    reservesRising4Weeks: reserves.met,
    rrpDeclining: rrp.met,
    tgaDeclining: tga.met,
    realRateFallingOrLowFlat: realRate2.met,
    creditSpreadNarrowing: creditSpread.met,
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
    { label: "금 가격 방향", criterion: "하락 시 충족(사분면 최고점 조합의 방향)", value: dirLabel(goldDir), met: goldDir === "down" },
    { label: "실질금리 방향", criterion: "상승 시 충족(사분면 최고점 조합의 방향)", value: dirLabel(realRateDir), met: realRateDir === "up" },
    { label: "달러 방향(USD/KRW)", criterion: "보조 확인 — 실질금리와 같은 방향이면 신호 강함", value: dirLabel(dollarDir), met: step4.dollarConfirms },
    { label: "사분면 판정", criterion: "위험선호 우호적 조합(금↓+실질금리↑ 또는 금↑+실질금리↓/보합) 시 충족", value: `${step4.quadrant} — 점수 ${step4.score}/10`, met: step4.score >= 5 },
  ];

  // 보조 지표 — 환율(USD/KRW, USD/JPY)·유가(WTI, 브렌트)의 전일 대비 변동. 원본 프롬프트의 4개 핵심 지표
  // 구조를 그대로 유지하려고 집계엔 안 넣고, 2단계와 같은 방식으로 별도 토글("보조 지표 보기")로 뺀다.
  const usdKrwChange = await dailyChange(METRICS.USDKRW);
  const usdJpyChange = await dailyChange(METRICS.USDJPY);
  const wtiChange = await dailyChange(METRICS.WTI);
  const brentChange = await dailyChange(METRICS.BRENT);
  const wtiDir = (await directionOf(METRICS.WTI)) ?? "flat";
  details.step4Aux = [
    { label: "USD·KRW", criterion: "강달러(상승)면 Risk-Off 쪽 신호", value: fmtDailyChange(usdKrwChange, "원"), met: null },
    { label: "USD·JPY", criterion: "강달러(상승)면 Risk-Off 쪽 신호", value: fmtDailyChange(usdJpyChange, "엔"), met: null },
    { label: "WTI유 선물", criterion: "고유가(상승)면 Risk-Off 쪽 신호", value: fmtDailyChange(wtiChange, "달러"), met: null },
    { label: "브렌트유 선물", criterion: "고유가(상승)면 Risk-Off 쪽 신호", value: fmtDailyChange(brentChange, "달러"), met: null },
  ];

  details.step4Summary = summarizeStep4(
    step4,
    { dollarDir, oilDir: wtiDir },
    {
      vetoTriggered: step1.vetoTriggered,
      overseasQualifyingCount: step2.overseasQualifyingCount,
      overseasTotalCount: step2.overseasTotalCount,
      carryZone: step3.zone,
      jpySpike: jpySpike.spike,
    }
  );

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

  // 마감가·전일 대비 변동폭·등락률 — 나스닥 카페 "매크로 환경 및 주요 지수 마감 동향" 형식 참고.
  const ndxChange = await dailyChange(METRICS.NDX);
  const rutChange = await dailyChange(METRICS.RUT);
  const djiChange = await dailyChange(METRICS.DJI);
  const spxChange = await dailyChange(METRICS.SPX);
  const btcChange = await dailyChange(METRICS.BTC);
  const ethChange = await dailyChange(METRICS.ETH);

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
      criterion: "SPX 우세=위험선호, DJI 우세=안전선호, 동률=중립",
      value: `다우존스 ${fmt(djiReturn20d, 2, "%")} / S&P500 ${fmt(spxReturn20d, 2, "%")} — (20거래일)`,
      met: null,
      result: step5.riskAppetite,
    },
    {
      label: "암호화폐 동조 분석",
      criterion: "나스닥과 같은 방향이면 위험선호 동조, 다르면 코인 고유 이슈 가능",
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
  const bigTechChanges = await Promise.all(BIG_TECH_TICKERS.map((ticker) => dailyChange(ticker)));
  const bigTechReasons = manualInputs.bigTechReasons ?? {};
  const reasonFor = (ticker: string) => bigTechReasons[ticker] ?? "원인 확인 못함(Gemini 미판정)";
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

  // 6단계
  const step6 = scoreStep6({ sectors: manualInputs.sectors });
  const qualifyingSet = new Set(step6.qualifying);
  details.step6 = manualInputs.sectors.length > 0
    ? manualInputs.sectors.map((s) => {
        const qualifying = qualifyingSet.has(s.name);
        const dailyPart = s.changePct1d !== undefined ? ` · 1일 ${fmt(s.changePct1d, 2, "%")}` : "";
        return {
          label: s.name,
          criterion: "5일 수익률 상위 3위 이내 + 거래량 20일 평균 대비 130%+",
          value: `5일 ${fmt(s.return5d, 2, "%")}${dailyPart} · 거래량 ${s.volumeRatio.toFixed(2)}배 — ${sectorRationale(qualifying, s.return5d, s.volumeRatio)}`,
          met: qualifying,
        };
      })
    : [{ label: "섹터 데이터", criterion: "-", value: "확인 못함", met: null }];
  details.step6Summary = summarizeStep6(step6, manualInputs.sectors);

  // 7단계
  const vix = await getLatestMetric(METRICS.VIX);
  const fearGreedMetric = await getLatestMetric(METRICS.CNN_FEAR_GREED);
  const fearGreed = fearGreedMetric?.value ?? null;
  const step7 = scoreStep7({ vix: vix?.value ?? null, fearGreed });

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

  const DATAROMA_URL = "https://www.dataroma.com/m/allact.php?typ=a";
  const OPENINSIDER_URL = "http://openinsider.com/latest-insider-trading";

  // 표를 2개로 나눈다 — ①기관·내부자 매집(신규, 충족열 없음, 바로가기 열 있음) ②공포탐욕·VIX 지수(기존, 충족열 유지).
  details.step7Institutional = [
    { label: "슈퍼 투자자 포트폴리오", criterion: "고래/헤지펀드 매매 내역", value: institutional?.superInvestorSummary ?? "확인 못함", met: null, url: DATAROMA_URL },
    { label: "종목별 기관 지분 분석", criterion: "종목 중심의 스마트머니 추적", value: institutional?.stockConsensusSummary ?? "확인 못함", met: null, url: DATAROMA_URL },
    { label: "섹터 및 자금 흐름", criterion: "자금 유입/유출 동향", value: institutional?.sectorFlowSummary ?? "확인 못함", met: null, url: DATAROMA_URL },
    { label: "내부자 거래", criterion: "기업 임원/대주주 매매 기록", value: institutional?.insiderTradeSummary ?? "확인 못함", met: null, url: OPENINSIDER_URL },
    { label: "전단계 섹터·종목과 일치 여부", criterion: "5·6단계 분석과 비교", value: institutionalMatch, met: null },
  ];
  details.step7 = [
    { label: "VIX", criterion: "<15 과열 / >25 공포", value: fmt(vix?.value ?? null, 2), met: null },
    {
      label: "CNN 공포와 탐욕지수",
      criterion: "0~24 극단적공포 · 25~44 공포 · 45~55 중립 · 56~75 탐욕 · 76~100 극단적탐욕",
      value: fearGreed !== null ? `${fearGreed.toFixed(1)}(${cnnFearGreedRating(fearGreed)})` : "확인 못함",
      met: null,
    },
    { label: "양쪽 동시 과열", criterion: "매수 크기 30% 축소", value: step7.bothOverheated ? "예" : "아니오", met: !step7.bothOverheated },
    { label: "공포 구간", criterion: "역발상 매수 기회 고려", value: step7.fearZone ? "예" : "아니오", met: null },
  ];
  details.step7Summary = summarizeStep7(institutional, sectorMatch, tickerMatch, vix?.value ?? null, fearGreed, step7);

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
