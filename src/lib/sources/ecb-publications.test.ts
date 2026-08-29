import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEcbPublications } from "./ecb-publications";

// 픽스처는 2026-08-29 실측 https://www.ecb.europa.eu/rss/press.html 응답 구조를 그대로 축약함.
const ECB_XML = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
<item><title> Isabel Schnabel: Central banks on-chain</title><link>https://www.ecb.europa.eu//press/key/date/2026/html/ecb.sp260828~fe9afc86e8.en.html</link><pubDate>Fri, 28 Aug 2026 18:00:00 +0200</pubDate></item>
<item><title> Meeting of 22-23 July 2026</title><link>https://www.ecb.europa.eu//press/accounts/2026/html/ecb.mg260827~f06c21fd54.en.html</link><pubDate>Thu, 27 Aug 2026 09:30:00 +0200</pubDate></item>
</channel></rss>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchEcbPublications", () => {
  it("최신 발간물 N건을 파싱해 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(ECB_XML) } as Response)));

    const { publications, errors } = await fetchEcbPublications(5);

    expect(errors).toEqual([]);
    expect(publications).toHaveLength(2);
    expect(publications[0].title).toContain("Schnabel");
    expect(publications[0].url).toContain("ecb.sp260828");
  });

  it("limit으로 건수를 제한한다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(ECB_XML) } as Response)));

    const { publications } = await fetchEcbPublications(1);

    expect(publications).toHaveLength(1);
  });

  it("HTTP 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, text: () => Promise.resolve("") } as Response)));

    const { publications, errors } = await fetchEcbPublications(5);

    expect(publications).toEqual([]);
    expect(errors[0]).toContain("ECB RSS 조회 실패");
  });

  it("네트워크 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));

    const { publications, errors } = await fetchEcbPublications(5);

    expect(publications).toEqual([]);
    expect(errors[0]).toContain("network down");
  });
});
