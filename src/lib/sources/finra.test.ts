import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchShortVolumeRatios } from "./finra";

function textResponse(ok: boolean, body = ""): Response {
  return { ok, text: () => Promise.resolve(body) } as Response;
}

const SAMPLE_FILE = [
  "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market",
  "20260807|AAPL|5540409|31490|13330297|B,Q,N",
  "20260807|NVDA|16394893|155044|44150363|B,Q,N",
  "20260807|ZZZZ|100|0|1000|Q",
].join("\n");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchShortVolumeRatios", () => {
  it("요청한 티커만 골라 비중을 계산한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(true, SAMPLE_FILE));
    vi.stubGlobal("fetch", fetchMock);

    const { rows, fileDate } = await fetchShortVolumeRatios(["AAPL", "NVDA"], new Date("2026-08-07"));

    expect(fileDate).toBe("20260807");
    expect(rows.size).toBe(2);
    expect(rows.get("AAPL")?.ratio).toBeCloseTo(5540409 / 13330297, 5);
    expect(rows.has("ZZZZ")).toBe(false);
  });

  it("주말 등으로 파일이 없으면 이전 거래일까지 거슬러 올라간다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse(false)) // 일요일
      .mockResolvedValueOnce(textResponse(false)) // 토요일
      .mockResolvedValueOnce(textResponse(true, SAMPLE_FILE)); // 금요일
    vi.stubGlobal("fetch", fetchMock);

    const { rows, fileDate } = await fetchShortVolumeRatios(["AAPL"], new Date("2026-08-09"));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fileDate).toBe("20260807");
    expect(rows.get("AAPL")?.ticker).toBe("AAPL");
  });

  it("maxLookback 내내 못 찾으면 빈 결과와 에러를 반환한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(false));
    vi.stubGlobal("fetch", fetchMock);

    const { rows, fileDate, errors } = await fetchShortVolumeRatios(["AAPL"], new Date("2026-08-09"), 3);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fileDate).toBeNull();
    expect(rows.size).toBe(0);
    expect(errors.length).toBeGreaterThan(0);
  });
});
