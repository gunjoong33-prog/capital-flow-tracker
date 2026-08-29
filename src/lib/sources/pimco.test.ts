import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPimcoOutlooks } from "./pimco";

// 픽스처는 2026-08-29 실측 pimco.com/us/en/insights 상단 내비게이션 마크업을 그대로 축약함.
const PIMCO_HTML = `<ul>
<li><a href="/us/en/insights/rupture-and-resilience" class="nav-link gtm-topnav-event" data-datalayer-clicktext="Secular Outlook" data-datalayer-subsection="OUTLOOKS" >Secular Outlook</a></li>
<li><a href="/us/en/insights/layered-uncertainty-conflict-credit-stress-and-ai" class="nav-link gtm-topnav-event" data-datalayer-clicktext="Cyclical Outlook" data-datalayer-subsection="OUTLOOKS" >Cyclical Outlook</a></li>
</ul>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPimcoOutlooks", () => {
  it("Secular·Cyclical Outlook 최신 링크를 절대경로로 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(PIMCO_HTML) } as Response)));

    const { outlooks, errors } = await fetchPimcoOutlooks();

    expect(errors).toEqual([]);
    expect(outlooks).toEqual([
      { label: "Secular Outlook", url: "https://www.pimco.com/us/en/insights/rupture-and-resilience" },
      { label: "Cyclical Outlook", url: "https://www.pimco.com/us/en/insights/layered-uncertainty-conflict-credit-stress-and-ai" },
    ]);
  });

  it("링크를 못 찾으면 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve("<html></html>") } as Response)));

    const { outlooks, errors } = await fetchPimcoOutlooks();

    expect(outlooks).toEqual([]);
    expect(errors.length).toBe(1);
  });

  it("HTTP 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, text: () => Promise.resolve("") } as Response)));

    const { outlooks, errors } = await fetchPimcoOutlooks();

    expect(outlooks).toEqual([]);
    expect(errors[0]).toContain("PIMCO 조회 실패");
  });
});
