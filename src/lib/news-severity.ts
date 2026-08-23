// 1단계 뉴스 리스크 라벨링의 순수 판정 로직. news-events.ts에서 분리한 이유는 그쪽이 모듈
// 최상단에서 db를 import해 DATABASE_URL 없이는 로드조차 안 되는데, 이 함수들은 DB가 전혀
// 필요 없고 CI(순수 함수 테스트만 돌림)에서 회귀를 잡아야 하기 때문이다.

export type NewsSeverity = "high" | "medium" | "low";

// 월가 리스크 지수(Fed GPR: Threats/Acts 구분, BlackRock BGRI: 출처·최근성 가중)를 참고해
// "건수"가 아니라 "심각도 × 출처 신뢰도 × 최근성"을 곱한 가중점수로 거부권을 판단한다.
// 심각도 가중치. "normal"은 심각도가 2단계(high/normal)였던 과거 데이터와의 호환용 — 새 분류에서는
// 나오지 않지만, 전환 시점엔 최근 7일 창에 예전 방식으로 저장된 기록이 섞여 있을 수 있어 medium과
// 동일하게 취급한다(7일이 지나면 창에서 자연히 빠짐).
const SEVERITY_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1, normal: 2 };

// 출처 가중치(NewsEvent.priority 기준: 0=백악관·연준, 1=권력 네트워크 유출, 2=일반). BGRI가 브로커리지
// 리포트(전문 소스)에 일반 뉴스보다 더 큰 비중을 두는 것과 같은 원리 — 백악관·연준의 공식 발표가 같은
// 심각도라도 일반 뉴스보다 신뢰도·직접성이 높다고 보고 더 크게 반영한다.
const PRIORITY_WEIGHT: Record<number, number> = { 0: 1.5, 1: 1.2, 2: 1.0 };

/** 발행일로부터 지난 일수에 따른 최근성 감쇠. BGRI가 최근 뉴스에 더 큰 비중을 두는 것과 같은 원리 —
 * 6일 전 소소한 뉴스가 오늘 뉴스와 똑같은 무게로 누적되는 걸 막는다. */
function recencyWeight(daysAgo: number): number {
  if (daysAgo <= 1) return 1.0;
  if (daysAgo <= 4) return 0.7;
  return 0.4;
}

/** "단독 즉시발동" high 뉴스로 인정할 최근성 창(일). 7일이면 6일 전 뉴스가 오늘 결론을 뒤집는다. */
export const SEVERE_NEWS_WINDOW_DAYS = 2;

/** "단독 즉시발동"으로 인정할 최대 출처 우선순위(0=백악관·연준 공식, 1=권력네트워크 유출).
 *  일반 지정학 뉴스(2)의 high는 즉시발동에서 제외하고 강도 점수로만 반영한다 — 실측상 high 44건
 *  중 43건이 여기에 몰려 있어 이 경로 하나가 거부권을 상시 켜두고 있었다. */
export const SEVERE_NEWS_MAX_PRIORITY = 1;

/** 한 항목이 받을 수 있는 최대 가중치 = 심각도 high(3) × 출처 백악관·연준(1.5) × 당일(1.0). */
export const MAX_ITEM_WEIGHT = 3 * 1.5 * 1.0;

/** 위험점수 계산에 쓸 최대 항목 수. 한국은행 뉴스심리지수(NSI)가 매일 정확히 1만 문장을 뽑아
 * 수집량 변화와 무관한 지수를 만드는 것과 같은 원리 — 상위 N건만 쓰면 그물을 넓혀도 눈금이 안 흔들린다. */
export const RISK_ITEM_CAP = 20;

/**
 * 뉴스 위험 강도(0~10). 예전 newsRiskScore는 리스크 뉴스 가중치를 "전부 더한" 값이라 분모가 없었고,
 * 수집 범위를 넓히자(하루 4건 -> 139건) 점수가 그대로 10배 뛰어 임계값 20이 상시 초과 상태가 됐다
 * (7/31 이후 단 하루도 임계 아래로 내려온 적 없음 — 실측). 세상이 위험해진 게 아니라 그물이 커진 것이다.
 *
 * 그래서 두 가지를 동시에 적용한다:
 *  - 상위 RISK_ITEM_CAP건만 사용(고정 표본 — 한국은행 NSI 방식)
 *  - 이론상 최대치(CAP × MAX_ITEM_WEIGHT)로 나눠 0~10으로 정규화(비중화 — 연준 GPR 방식)
 * 결과적으로 수집량이 20건을 넘어서면 점수가 수집량에 반응하지 않는다.
 */
export function computeNewsRiskIntensity(
  items: { priority: number; severity: string; date: Date }[],
  asOf: Date
): { intensity: number; usedCount: number; totalCount: number } {
  const weights = items.map((i) => newsItemWeight(i, asOf)).sort((a, b) => b - a);
  const top = weights.slice(0, RISK_ITEM_CAP);
  const sum = top.reduce((a, b) => a + b, 0);
  const intensity = Math.round((sum / (RISK_ITEM_CAP * MAX_ITEM_WEIGHT)) * 1000) / 100;
  return { intensity, usedCount: top.length, totalCount: weights.length };
}

/** 개별 뉴스 항목의 리스크 가중치(심각도 × 출처 × 최근성). */
export function newsItemWeight(item: { priority: number; severity: string; date: Date }, asOf: Date): number {
  const daysAgo = Math.floor((asOf.getTime() - item.date.getTime()) / (1000 * 60 * 60 * 24));
  const severityWeight = SEVERITY_WEIGHT[item.severity] ?? 1;
  const priorityWeight = PRIORITY_WEIGHT[item.priority] ?? 1.0;
  return severityWeight * priorityWeight * recencyWeight(Math.max(0, daysAgo));
}

// 아직 벌어지지 않은 일(전망·우려·경고·계획)을 가리키는 표현. 이런 근거로 매겨진 "high"는
// 실제로는 medium 이하다 — 프롬프트에 같은 금지 목록을 넣어도 temperature>0라 새기 때문에
// 코드에서 한 번 더 막는다.
const HEDGE_PATTERN =
  /(가능성|전망|우려|경고|촉구|요구|검토|예정(?!에\s*없)|계획(?!에\s*없)|시사|압박|위협|위험이|긴장\s*고조|할\s*수도|것으로\s*보인다|예상된다|may\s|could\s|plan(s|ned)?\s|threaten|warn|urge|consider|risk of)/i;

/**
 * high인데 근거가 부실하면 medium으로 강등한다.
 *
 * 실측 배경: 저장된 severity=high 44건 중 43건이 일반 지정학 기사(priority 2)였고 공식 발표발은
 * 0건이었다 — LLM이 "단독으로 시장을 흔들 수준" 라벨을 하루 1~2건씩 남발해 1단계 거부권이
 * 21일 중 15일을 이 경로 하나로 발동시키고 있었다. 예전 가드는 evidence 길이 8자만 봐서
 * "확전 우려 고조" 같은 문장을 그대로 통과시켰다.
 */
export function downgradeUnsupportedHigh(severity: NewsSeverity, evidence: string | undefined): NewsSeverity {
  if (severity !== "high") return severity;
  const text = evidence?.trim() ?? "";
  if (text.length < 15) return "medium"; // 주체·행동·대상을 다 담기엔 너무 짧다
  if (HEDGE_PATTERN.test(text)) return "medium"; // 아직 안 벌어진 일
  return severity;
}

/** 하루에 인정할 high 최대 건수. 실제로 이 등급 사건이 하루에 여러 건 겹치는 일은 거의 없다. */
export const MAX_HIGH_PER_DAY = 1;

/**
 * 한 배치에서 high가 MAX_HIGH_PER_DAY를 넘으면 앞선 것만 남기고 나머지를 medium으로 내린다.
 * 거부권은 high가 1건만 있어도 발동하므로 이 상한 때문에 놓치는 신호는 없고, LLM이 여러 건에
 * 최고 등급을 남발하는 경우만 잘라낸다.
 */
export function capDailyHighSeverity<T extends { severity: NewsSeverity }>(items: T[]): T[] {
  let kept = 0;
  return items.map((item) => {
    if (item.severity !== "high") return item;
    kept += 1;
    return kept <= MAX_HIGH_PER_DAY ? item : { ...item, severity: "medium" as NewsSeverity };
  });
}

// FOMC·BOJ 통화정책 회의는 날짜가 미리 공개된 정기 일정(major-events.ts FOMC_DATES_2026·
// BOJ_DATES_2026 참고)이라, 사이트의 "high" 정의("예상 밖 긴급" 사건)에 구조적으로 해당하지
// 않는다 — 실제 서프라이즈 여부(반대표 수 등)는 event-outcomes.ts의 fedRateChanged()가 성명서
// 원문을 직접 읽어 별도로(EventOutcome.risky) 정확히 판단한다. Gemini의 severity 판정은
// temperature>0라 완전히 결정론적이지 않아 같은 "FOMC statement 발표" 헤드라인이 실행마다
// medium/high를 오갈 수 있어, 여기서 상한을 강제한다.
const SCHEDULED_POLICY_MEETING_PATTERN = /FOMC|Federal Open Market Committee|Bank of Japan.{0,20}(monetary policy|rate decision)/i;

export function capScheduledPolicyMeetingSeverity(title: string, severity: NewsSeverity): NewsSeverity {
  if (severity === "high" && SCHEDULED_POLICY_MEETING_PATTERN.test(title)) return "medium";
  return severity;
}

