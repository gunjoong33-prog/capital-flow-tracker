import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBokEconomicOutlook, parseBokDetailHtml, parseBokListHtml } from "./bok-economic-outlook";

// 픽스처는 2026-09-01 실측 bok.or.kr/portal/singl/newsData/listCont.do,
// bok.or.kr/portal/bbs/P0002359/view.do 응답 구조를 그대로 축약함.
const LIST_HTML = `<ul><li>
<a href="/portal/bbs/P0002359/view.do?nttId=11064210&depth=200066&depth2=200699&depth3=200066&menuNo=200066" class="title">
<!-- <span class="ti-announcement"><span class="sr-only">공지사항</span></span>   -->
경제전망보고서(2026년 8월)
</a>
</li></ul>`;

const DETAIL_HTML = `<div>
<a href="/fileSrc/portal/abc123/1/def456.pdf">첨부파일</a>
<a href="/static/jslibrary/pdfjs/viewer.html?file=%2FfileSrc%2Fportal%2Fabc123%2F1%2Fdef456.pdf">미리보기</a>
</div>`;

describe("parseBokListHtml", () => {
  it("HTML 주석을 건너뛰고 게시물 번호·제목을 뽑는다", () => {
    expect(parseBokListHtml(LIST_HTML)).toEqual({ nttId: "11064210", title: "경제전망보고서(2026년 8월)" });
  });

  it("목록이 비어 있으면 null을 반환한다", () => {
    expect(parseBokListHtml("<ul></ul>")).toBeNull();
  });
});

describe("parseBokDetailHtml", () => {
  it("첫 번째 fileSrc PDF 링크를 절대경로로 반환한다", () => {
    expect(parseBokDetailHtml(DETAIL_HTML)).toBe("https://www.bok.or.kr/fileSrc/portal/abc123/1/def456.pdf");
  });

  it("PDF 링크가 없으면 null을 반환한다", () => {
    expect(parseBokDetailHtml("<div></div>")).toBeNull();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchBokEconomicOutlook", () => {
  it("목록에서 최신 게시물을 찾은 뒤 상세에서 PDF 링크까지 반환한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const html = url.includes("view.do") ? DETAIL_HTML : LIST_HTML;
        return Promise.resolve({ ok: true, text: () => Promise.resolve(html) } as Response);
      })
    );

    const { report, errors } = await fetchBokEconomicOutlook();

    expect(errors).toEqual([]);
    expect(report).toEqual({
      title: "경제전망보고서(2026년 8월)",
      url: "https://www.bok.or.kr/fileSrc/portal/abc123/1/def456.pdf",
    });
  });

  it("목록 조회 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, text: () => Promise.resolve("") } as Response)));

    const { report, errors } = await fetchBokEconomicOutlook();

    expect(report).toBeNull();
    expect(errors[0]).toContain("한국은행 경제전망보고서 목록 조회 실패");
  });
});
