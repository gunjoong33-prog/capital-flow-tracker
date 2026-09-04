import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/metrics", () => ({ getMetricHistoryByCount: vi.fn() }));
vi.mock("@/lib/sources/news-feeds", () => ({ fetchBigTechHeadlines: vi.fn() }));
vi.mock("@/lib/llm-clients", async () => {
  const actual = await vi.importActual<typeof import("./llm-clients")>("./llm-clients");
  return { callClaude: vi.fn(), extractJsonArray: actual.extractJsonArray };
});

import { getMetricHistoryByCount } from "@/lib/metrics";
import { fetchBigTechHeadlines } from "@/lib/sources/news-feeds";
import { callClaude } from "@/lib/llm-clients";
import { computeBigTechReasons } from "./bigtech-reasons";

const ASOF = new Date("2026-08-24T21:00:00.000Z");

// history[0]=전일, history[1]=당일 (metrics.ts getMetricHistoryByCount는 오름차순으로 반환)
function history(prev: number, curr: number) {
  return [{ value: prev }, { value: curr }] as any;
}

describe("computeBigTechReasons", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // restoreAllMocks는 vi.spyOn 대상만 초기화한다 — 모듈 목의 mock.calls 누적은 별도로 비워야 함
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.mocked(fetchBigTechHeadlines).mockResolvedValue({ byTicker: {}, errors: [] });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("종목별로 개별 Groq 호출을 한다 — 하나가 계속 실패해도(429 소진) 나머지는 정상 판정된다(8/24·25 회귀 재현·검증)", async () => {
    vi.mocked(getMetricHistoryByCount).mockImplementation(async (ticker: string) => {
      if (ticker === "AAA") return history(100, 110); // +10%
      if (ticker === "BBB") return history(100, 90); // -10%
      return history(100, 100); // CCC: 변동 없음
    });
    vi.mocked(callClaude).mockImplementation(async (prompt: unknown) => {
      const p = prompt as string;
      if (p.includes("AAA(")) return '[{"ticker":"AAA","reason":"AAA 실적 호조로 상승했습니다.","direction":"up"}]';
      if (p.includes("BBB(")) {
        // 실측 재현: 재시도 3회를 다 써도 여전히 429라 callClaude가 던지는 경우
        throw new Error(
          'Groq 요청 실패: 429 {"error":{"message":"Rate limit reached ... tokens per minute (TPM)"}}'
        );
      }
      return '[{"ticker":"CCC","reason":"명확한 원인 확인 안 됨","direction":"flat"}]';
    });

    const { reasons, errors } = await computeBigTechReasons(["AAA", "BBB", "CCC"], ASOF);

    // 실패한 BBB만 결과에서 빠지고(전체 판정이 함께 죽지 않음), 성공한 AAA·CCC는 정상 반환된다.
    expect(reasons).toEqual({
      AAA: "AAA 실적 호조로 상승했습니다.",
      CCC: "명확한 원인 확인 안 됨",
    });
    expect(reasons.BBB).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/429/);
    expect(callClaude).toHaveBeenCalledTimes(3); // 3종목 전부 개별 호출 시도(배치 1회 아님)
  });

  it("종목마다 maxTokens 2048로 Haiku를 호출한다(배치용 8192 회귀 방지)", async () => {
    vi.mocked(getMetricHistoryByCount).mockResolvedValue(history(100, 105));
    vi.mocked(callClaude).mockResolvedValue('[{"ticker":"AAA","reason":"이유","direction":"up"}]');

    await computeBigTechReasons(["AAA"], ASOF);

    expect(callClaude).toHaveBeenCalledWith(expect.any(String), {
      model: "claude-haiku-4-5-20251001",
      maxTokens: 2048,
    });
  });

  it("응답이 방향과 모순되면(direction 불일치) 대체 문구로 바뀐다 — bigtech-direction 검증이 실제로 연결돼 있다", async () => {
    vi.mocked(getMetricHistoryByCount).mockResolvedValue(history(100, 90)); // -10%(하락)
    vi.mocked(callClaude).mockResolvedValue('[{"ticker":"AAA","reason":"목표주가 상향으로 상승했습니다.","direction":"up"}]');

    const { reasons } = await computeBigTechReasons(["AAA"], ASOF);

    expect(reasons).toEqual({ AAA: "명확한 원인 확인 안 됨" });
  });

  it("Groq 응답이 JSON 배열이 아니면(파싱 실패) 그 종목만 에러로 기록되고 결과에서 빠진다", async () => {
    vi.mocked(getMetricHistoryByCount).mockResolvedValue(history(100, 105));
    vi.mocked(callClaude).mockResolvedValue("이 문장은 JSON이 아닙니다.");

    const { reasons, errors } = await computeBigTechReasons(["AAA"], ASOF);

    expect(reasons.AAA).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/파싱 실패/);
  });

  it("ANTHROPIC_API_KEY가 없으면 Claude를 호출하지 않고 빈 결과를 반환한다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.mocked(getMetricHistoryByCount).mockResolvedValue(history(100, 105));

    const { reasons, errors } = await computeBigTechReasons(["AAA"], ASOF);

    expect(reasons).toEqual({});
    expect(errors).toEqual([]);
    expect(callClaude).not.toHaveBeenCalled();
  });

  it("뉴스 헤드라인 조회(fetchBigTechHeadlines) 에러도 errors에 합쳐진다", async () => {
    vi.mocked(getMetricHistoryByCount).mockResolvedValue(history(100, 105));
    vi.mocked(fetchBigTechHeadlines).mockResolvedValue({ byTicker: {}, errors: ["google-news-AAA: 타임아웃"] });
    vi.mocked(callClaude).mockResolvedValue('[{"ticker":"AAA","reason":"이유","direction":"up"}]');

    const { errors } = await computeBigTechReasons(["AAA"], ASOF);

    expect(errors).toContain("google-news-AAA: 타임아웃");
  });

  it("전일 데이터가 부족하면(history 1건 이하) changePct1d를 null로 두고 '확인 못함'으로 프롬프트에 넣는다", async () => {
    vi.mocked(getMetricHistoryByCount).mockResolvedValue([{ value: 100 }] as any); // 1건뿐
    vi.mocked(callClaude).mockResolvedValue('[{"ticker":"AAA","reason":"명확한 원인 확인 안 됨","direction":"flat"}]');

    await computeBigTechReasons(["AAA"], ASOF);

    const prompt = vi.mocked(callClaude).mock.calls[0][0] as string;
    expect(prompt).toContain("확인 못함");
  });
});
