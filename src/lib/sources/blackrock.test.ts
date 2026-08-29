import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBlackrockCommentary } from "./blackrock";

// 픽스처는 2026-08-29 실측 blackrock.com weekly-commentary 페이지 h1/h2 구조를 그대로 축약함.
const BLACKROCK_HTML = `<html><body><h1>Weekly market commentary</h1><h2 class="extra-bold">Two market signals, one story</h2><h2 class="h2-dark-blue">Our bottom line</h2></body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchBlackrockCommentary", () => {
  it("h1+첫 h2를 합쳐 이번 주 제목을 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(BLACKROCK_HTML) } as Response)));

    const { commentary, errors } = await fetchBlackrockCommentary();

    expect(errors).toEqual([]);
    expect(commentary).toEqual({
      title: "Weekly market commentary: Two market signals, one story",
      url: "https://www.blackrock.com/us/individual/insights/blackrock-investment-institute/weekly-commentary",
    });
  });

  it("h1을 못 찾으면 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve("<html></html>") } as Response)));

    const { commentary, errors } = await fetchBlackrockCommentary();

    expect(commentary).toBeNull();
    expect(errors.length).toBe(1);
  });

  it("HTTP 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, text: () => Promise.resolve("") } as Response)));

    const { commentary, errors } = await fetchBlackrockCommentary();

    expect(commentary).toBeNull();
    expect(errors[0]).toContain("BlackRock 조회 실패");
  });
});
