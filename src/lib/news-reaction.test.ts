import { describe, it, expect } from "vitest";
import { pickReactionBars, type IntradayBar } from "./news-reaction";

const bars: IntradayBar[] = [
  { timestamp: 1000, close: 100 },
  { timestamp: 1300, close: 101 },
  { timestamp: 1600, close: 103 },
  { timestamp: 1900, close: 99 },
];

describe("pickReactionBars", () => {
  it("발행 시각 이후 첫 봉을 snap으로, 마지막 봉을 latest로 고른다", () => {
    const result = pickReactionBars(bars, 1250);
    expect(result?.snap.timestamp).toBe(1300);
    expect(result?.latest.timestamp).toBe(1900);
  });

  it("발행 시각이 데이터 범위보다 이전이면 첫 봉을 snap으로 쓴다", () => {
    const result = pickReactionBars(bars, 0);
    expect(result?.snap.timestamp).toBe(1000);
  });

  it("발행 시각이 데이터 범위보다 나중이면(막 발행돼 봉이 안 찍힘) 마지막 봉으로 대체한다", () => {
    const result = pickReactionBars(bars, 9999);
    expect(result?.snap.timestamp).toBe(1900);
    expect(result?.snap).toBe(result?.latest);
  });

  it("봉이 1개 이하면 null을 돌려준다(비교 불가)", () => {
    expect(pickReactionBars([{ timestamp: 1000, close: 100 }], 500)).toBeNull();
    expect(pickReactionBars([], 500)).toBeNull();
  });
});
