import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMiraeassetResearch, parseMiraeassetHtml } from "./miraeasset-research";

// 픽스처는 2026-09-01 실측 securities.miraeasset.com/bbs/board/message/list.do?categoryId=1521
// 응답(디코딩 후) 구조를 그대로 축약함 — 제목은 텍스트 노드가 아니라 title 속성에만 있다.
const HTML = `<p class="bbsList_layer_icon">
<a href="javascript:downConfirm('https://securities.miraeasset.com/bbs/download/2147046.pdf?attachmentId=2147046','2147046','1024','768','yes','yes');" title="20260901_One-Asia Tech Strategy.pdf(새창열림)">
<img src="ic_file.gif" alt="첨부파일"/></a></p>
<p class="bbsList_layer_icon">
<a href="javascript:downConfirm('https://securities.miraeasset.com/bbs/download/2147045.pdf?attachmentId=2147045','2147045','1024','768','yes','yes');" title="20260901_한국&amp;중국 마켓 클로징(9월 1일).pdf(새창열림)">
<img src="ic_file.gif" alt="첨부파일"/></a></p>`;

describe("parseMiraeassetHtml", () => {
  it("PDF 링크·날짜·제목을 파싱하고 HTML 엔티티를 디코딩한다", () => {
    const items = parseMiraeassetHtml(HTML, 10);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      url: "https://securities.miraeasset.com/bbs/download/2147046.pdf",
      date: "20260901",
      title: "One-Asia Tech Strategy",
    });
    expect(items[1].title).toBe("한국&중국 마켓 클로징(9월 1일)");
  });

  it("limit으로 건수를 제한한다", () => {
    expect(parseMiraeassetHtml(HTML, 1)).toHaveLength(1);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMiraeassetResearch", () => {
  it("HTTP 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) } as Response)));

    const { items, errors } = await fetchMiraeassetResearch();

    expect(items).toEqual([]);
    expect(errors[0]).toContain("미래에셋증권 리서치 조회 실패");
  });
});
