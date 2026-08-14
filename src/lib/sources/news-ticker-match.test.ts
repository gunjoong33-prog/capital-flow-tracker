import { describe, it, expect } from "vitest";
import { matchTickers } from "./news-ticker-match";

describe("matchTickers", () => {
  it("한글 회사명이 있으면 매칭한다", () => {
    const result = matchTickers("애플, 아이폰 판매 부진에 목표주가 하향");
    expect(result.map((t) => t.code)).toContain("AAPL");
  });

  it("영문 회사명도 매칭한다", () => {
    const result = matchTickers("Tesla shares fall after earnings miss");
    expect(result.map((t) => t.code)).toContain("TSLA");
  });

  it("한 기사에서 여러 종목을 동시에 찾는다", () => {
    const result = matchTickers("엔비디아·아마존, AI 인프라 투자 확대 발표");
    const codes = result.map((t) => t.code);
    expect(codes).toContain("NVDA");
    expect(codes).toContain("AMZN");
  });

  it("관련 없는 기사는 빈 배열을 돌려준다", () => {
    expect(matchTickers("전국 폭염특보, 온열질환 주의보 발령")).toEqual([]);
  });

  it("사전에 없는 섹터 일반 명사는 매칭하지 않는다(오탐 방지)", () => {
    // "금융" 같은 흔한 단어를 섹터 ETF와 매칭시키지 않는 설계 — 오탐 방지가 목적.
    expect(matchTickers("금융권 대출 규제 강화 논의")).toEqual([]);
  });

  it("WTI·국제유가 키워드를 구분해 각각 매칭한다", () => {
    expect(matchTickers("WTI 선물가 급락").map((t) => t.code)).toContain("WTI");
    expect(matchTickers("국제유가 하락세 지속").map((t) => t.code)).toContain("WTI");
    expect(matchTickers("브렌트유 강보합").map((t) => t.code)).toContain("브렌트유");
  });
});
