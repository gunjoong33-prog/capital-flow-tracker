import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { callGroq, extractJsonArray } from "./llm-clients";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function textResponse(text: string, status: number, headers: Record<string, string> = {}) {
  return new Response(text, { status, headers });
}

const OK_BODY = { choices: [{ message: { content: "  응답 텍스트  " } }] };

describe("callGroq", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("성공 응답이면 trim된 텍스트를 반환한다(재시도 없음)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(OK_BODY));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callGroq("프롬프트");

    expect(result).toBe("응답 텍스트");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 한 번 뒤 성공하면 정확히 1번만 재시도하고 결과를 반환한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse('{"error":"try again in 0.01s"}', 429))
      .mockResolvedValueOnce(jsonResponse(OK_BODY));
    vi.stubGlobal("fetch", fetchMock);

    const promise = callGroq("프롬프트");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("응답 텍스트");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429가 롤링 윈도우 때문에 재시도 중에도 또 걸리면 최대 3번까지 재시도한다(TPM 회귀 재현 케이스)", async () => {
    // 8/24·8/25에 실제로 겪은 패턴: 1차 재시도 후에도 다른 순차 호출이 쓴 토큰 때문에 또 429가
    // 뜬 사례(NVDA) — 최대 3회까지는 버텨야 한다.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse('{"error":"try again in 0.01s"}', 429))
      .mockResolvedValueOnce(textResponse('{"error":"try again in 0.01s"}', 429))
      .mockResolvedValueOnce(textResponse('{"error":"try again in 0.01s"}', 429))
      .mockResolvedValueOnce(jsonResponse(OK_BODY));
    vi.stubGlobal("fetch", fetchMock);

    const promise = callGroq("프롬프트");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("응답 텍스트");
    expect(fetchMock).toHaveBeenCalledTimes(4); // 최초 1회 + 재시도 3회
  });

  it("3번 재시도 후에도 429면 포기하고 에러를 던진다(무한 재시도 방지)", async () => {
    // mockResolvedValue는 같은 Response 인스턴스를 재사용해 body를 두 번 못 읽는다(fetch 응답 body는
    // 1회성) — 매 호출마다 새 Response를 만들어야 한다.
    const fetchMock = vi.fn().mockImplementation(async () => textResponse('{"error":"try again in 0.01s"}', 429));
    vi.stubGlobal("fetch", fetchMock);

    const promise = callGroq("프롬프트");
    const expectation = expect(promise).rejects.toThrow(/Groq 요청 실패: 429/);
    await vi.runAllTimersAsync();
    await expectation;

    expect(fetchMock).toHaveBeenCalledTimes(4); // 최초 1회 + 재시도 3회, 그 이상은 안 함
  });

  it("429가 아닌 에러(413 등)는 재시도 없이 즉시 던진다 — 단일 요청 크기 문제라 재시도해도 안 고쳐지므로", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      textResponse('{"error":{"message":"Request too large ... TPM: Limit 8000, Requested 10881"}}', 413)
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(callGroq("프롬프트")).rejects.toThrow(/Groq 요청 실패: 413/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Retry-After 헤더가 있으면 메시지 파싱보다 그 값을 우선한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse("{}", 429, { "retry-after": "0.01" }))
      .mockResolvedValueOnce(jsonResponse(OK_BODY));
    vi.stubGlobal("fetch", fetchMock);

    const promise = callGroq("프롬프트");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("응답 텍스트");
  });

  it("응답 본문에 텍스트가 없으면 에러를 던진다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callGroq("프롬프트")).rejects.toThrow("Groq 응답에 텍스트가 없다");
  });

  it("maxTokens·reasoningEffort 옵션을 요청 본문에 그대로 실어 보낸다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(OK_BODY));
    vi.stubGlobal("fetch", fetchMock);

    await callGroq("프롬프트", { maxTokens: 2048, reasoningEffort: "low" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(2048);
    expect(body.reasoning_effort).toBe("low");
  });
});

describe("extractJsonArray", () => {
  it("순수 JSON 배열을 파싱한다", () => {
    expect(extractJsonArray('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it("마크다운 코드펜스로 감싼 배열도 파싱한다", () => {
    expect(extractJsonArray('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  });

  it("배열이 없으면 null", () => {
    expect(extractJsonArray("배열 없음")).toBeNull();
  });

  it("깨진 JSON이면 null(throw 안 함)", () => {
    expect(extractJsonArray("[{broken")).toBeNull();
  });

  it("배열이 아닌 JSON(객체)이면 null", () => {
    expect(extractJsonArray('{"a":1}')).toBeNull();
  });
});
