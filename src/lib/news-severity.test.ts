import { describe, expect, it } from "vitest";
import {
  downgradeUnsupportedHigh,
  capDailyHighSeverity,
  capScheduledPolicyMeetingSeverity,
  MAX_HIGH_PER_DAY,
  type NewsSeverity,
} from "./news-severity";

// 배경: 저장된 severity=high 44건 중 43건이 일반 지정학 기사였고 공식 발표발은 0건이었다.
// 그 결과 1단계 거부권이 21일 중 15일을 "단독 즉시발동" 경로 하나로 발동시켰다.
// 아래 케이스들은 그때 실제로 통과했던 유형이다.
describe("downgradeUnsupportedHigh", () => {
  // "예정에 없던 긴급 회의"처럼 부정어가 붙으면 오히려 서프라이즈를 뜻한다 — 오탐 방지 고정.
  it("\"예정에 없던\"은 예정과 반대 뜻이므로 강등하지 않는다", () => {
    expect(downgradeUnsupportedHigh("high", "연준이 예정에 없던 긴급 회의에서 기준금리를 0.75%p 인하했다")).toBe("high");
    expect(downgradeUnsupportedHigh("high", "계획에 없던 국경 폐쇄를 양국이 동시에 단행했다")).toBe("high");
  });

  it("아직 벌어지지 않은 일(전망·우려·경고)은 high로 인정하지 않는다", () => {
    const hedges = [
      "중동 지역 확전 가능성이 커지고 있다는 분석이 나왔다",
      "미국이 추가 관세를 검토 중인 것으로 보인다",
      "연준 인사가 인플레이션 재확산을 경고했다고 전해졌다",
      "양국 간 긴장 고조로 무력 충돌 위험이 제기됐다",
      "The administration may impose new sanctions next month",
    ];
    for (const e of hedges) expect(downgradeUnsupportedHigh("high", e)).toBe("medium");
  });

  it("이미 벌어진 구체적 행동은 high로 유지한다", () => {
    expect(downgradeUnsupportedHigh("high", "이스라엘군이 이란 나탄즈 핵시설을 공습했다")).toBe("high");
    expect(downgradeUnsupportedHigh("high", "연준이 예정에 없던 긴급 회의에서 기준금리를 0.75%p 인하했다")).toBe("high");
  });

  it("근거가 너무 짧으면 강등한다", () => {
    expect(downgradeUnsupportedHigh("high", "전쟁")).toBe("medium");
    expect(downgradeUnsupportedHigh("high", "")).toBe("medium");
    expect(downgradeUnsupportedHigh("high", undefined)).toBe("medium");
  });

  it("medium·low는 근거와 무관하게 그대로 둔다", () => {
    expect(downgradeUnsupportedHigh("medium", undefined)).toBe("medium");
    expect(downgradeUnsupportedHigh("low", "확전 가능성")).toBe("low");
  });
});

describe("capDailyHighSeverity", () => {
  const item = (severity: NewsSeverity, title: string) => ({ severity, title });

  it("하루 high 상한을 넘는 항목은 medium으로 내린다", () => {
    const out = capDailyHighSeverity([
      item("high", "A"),
      item("high", "B"),
      item("medium", "C"),
      item("high", "D"),
    ]);
    expect(out.map((o) => o.severity)).toEqual(["high", "medium", "medium", "medium"]);
    expect(out.filter((o) => o.severity === "high")).toHaveLength(MAX_HIGH_PER_DAY);
  });

  it("상한 이하이면 아무것도 바꾸지 않는다", () => {
    const input = [item("medium", "A"), item("high", "B"), item("low", "C")];
    expect(capDailyHighSeverity(input).map((o) => o.severity)).toEqual(["medium", "high", "low"]);
  });

  it("high가 없으면 그대로 통과", () => {
    const input = [item("low", "A"), item("medium", "B")];
    expect(capDailyHighSeverity(input)).toEqual(input);
  });
});

describe("capScheduledPolicyMeetingSeverity", () => {
  it("정기 FOMC·BOJ 회의는 high가 될 수 없다", () => {
    expect(capScheduledPolicyMeetingSeverity("FOMC statement released", "high")).toBe("medium");
    expect(capScheduledPolicyMeetingSeverity("Bank of Japan rate decision due", "high")).toBe("medium");
  });

  it("정기 회의가 아닌 헤드라인은 그대로", () => {
    expect(capScheduledPolicyMeetingSeverity("Israel strikes Iran nuclear site", "high")).toBe("high");
  });
});
