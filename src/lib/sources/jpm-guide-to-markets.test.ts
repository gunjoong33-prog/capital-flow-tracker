import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJpmGuideToMarkets } from "./jpm-guide-to-markets";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJpmGuideToMarkets", () => {
  it("PDF가 존재하면 고정 URL과 Last-Modified를 반환한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          headers: new Headers({ "last-modified": "Thu, 02 Jul 2026 10:34:33 GMT" }),
        } as Response)
      )
    );

    const { guide, errors } = await fetchJpmGuideToMarkets();

    expect(errors).toEqual([]);
    expect(guide?.lastModified).toBe("Thu, 02 Jul 2026 10:34:33 GMT");
    expect(guide?.url).toContain("guide-to-the-markets");
  });

  it("HTTP 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, headers: new Headers() } as Response)));

    const { guide, errors } = await fetchJpmGuideToMarkets();

    expect(guide).toBeNull();
    expect(errors[0]).toContain("JPMorgan AM Guide to the Markets 조회 실패");
  });
});
