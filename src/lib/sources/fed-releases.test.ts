import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFedReleases } from "./fed-releases";

// 픽스처는 2026-08-29 실측 https://www.federalreserve.gov/feeds/press_all.xml 응답 구조를 그대로 축약함.
const PRESS_XML = `<?xml version="1.0" encoding="utf-8" ?>
<rss version="2.0"><channel>
<item>
<title>Federal Reserve Board issues enforcement action</title>
<link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/enforcement20260827a.htm]]></link>
<pubDate><![CDATA[Thu, 27 Aug 2026 15:00:00 GMT]]></pubDate>
</item>
</channel></rss>`;
const SPEECH_XML = `<?xml version="1.0" encoding="utf-8" ?>
<rss version="2.0"><channel>
<item>
<title>Chair Powell speech on economic outlook</title>
<link><![CDATA[https://www.federalreserve.gov/newsevents/speech/powell20260828a.htm]]></link>
<pubDate><![CDATA[Fri, 28 Aug 2026 18:00:00 GMT]]></pubDate>
</item>
</channel></rss>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchFedReleases", () => {
  it("보도자료·연설 두 피드를 합쳐 최신순으로 반환한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const xml = url.includes("speeches") ? SPEECH_XML : PRESS_XML;
        return Promise.resolve({ ok: true, text: () => Promise.resolve(xml) } as Response);
      })
    );

    const { releases, errors } = await fetchFedReleases(5);

    expect(errors).toEqual([]);
    expect(releases).toHaveLength(2);
    expect(releases[0].title).toContain("Powell"); // 8/28이 8/27보다 최신이라 먼저 나와야 함
    expect(releases[0].kind).toBe("speech");
    expect(releases[1].kind).toBe("press");
  });

  it("limit으로 반환 건수를 제한한다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(PRESS_XML) } as Response)));

    const { releases } = await fetchFedReleases(1);

    expect(releases).toHaveLength(1);
  });

  it("한 피드가 실패해도 다른 피드 결과는 반환하고 errors에 담는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("speeches")) return Promise.resolve({ ok: false, text: () => Promise.resolve("") } as Response);
        return Promise.resolve({ ok: true, text: () => Promise.resolve(PRESS_XML) } as Response);
      })
    );

    const { releases, errors } = await fetchFedReleases(5);

    expect(releases).toHaveLength(1);
    expect(errors.length).toBe(1);
  });

  it("네트워크 전체 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));

    const { releases, errors } = await fetchFedReleases(5);

    expect(releases).toEqual([]);
    expect(errors.length).toBe(2);
  });
});
