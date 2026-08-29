import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNaverResearch, parseNaverResearchHtml } from "./naver-research";

// 픽스처는 2026-08-29 실측 finance.naver.com/research/company_list.naver 응답 구조를 그대로
// 축약함(디코딩된 문자열 기준 — EUC-KR 바이트 디코딩 자체는 TextDecoder 표준 API라 별도 테스트 안 함).
// PDF 있는 행·없는 행을 각각 하나씩 포함해 둘 다 검증한다.
const HTML = `<table>
<tr><th>종목명</th></tr>
<tr><td colspan="6" class="blank_07"></td></tr>
<tr>
<td style="padding-left:10">
<a href="/item/main.naver?code=017670" title="SK텔레콤" class="stock_item">SK텔레콤</a>
</td>
<td><a href="company_read.naver?nid=95918&page=1">SK호라이즌과 SK하이퍼의 시너지 효과 본격화</a></td>
<td>미래에셋증권</td>
<td class="file">
<a href="https://stock.pstatic.net/stock-research/company/56/20260828_company_358452000.pdf" target="_blank"><img src="https://ssl.pstatic.net/imgstock/images5/down.gif" alt="pdf" align="absmiddle"></a>
</td>
<td class="date" style="padding-left:5px">26.08.28</td>
<td class="date">6029</td>
</tr>
<tr>
<td style="padding-left:10">
<a href="/item/main.naver?code=214150" title="클래시스" class="stock_item">클래시스</a>
</td>
<td><a href="company_read.naver?nid=95917&page=1">NDR 후기: 눈높이 하향 반영 완료</a></td>
<td>신한투자증권</td>
<td class="file">

</td>
<td class="date" style="padding-left:5px">26.08.28</td>
<td class="date">4816</td>
</tr>
</table>`;

describe("parseNaverResearchHtml", () => {
  it("PDF 있는 행·없는 행을 모두 파싱한다", () => {
    const items = parseNaverResearchHtml(HTML, 10);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      stockName: "SK텔레콤",
      title: "SK호라이즌과 SK하이퍼의 시너지 효과 본격화",
      broker: "미래에셋증권",
      pdfUrl: "https://stock.pstatic.net/stock-research/company/56/20260828_company_358452000.pdf",
      date: "26.08.28",
    });
    expect(items[1].pdfUrl).toBeNull();
  });

  it("limit으로 건수를 제한한다", () => {
    expect(parseNaverResearchHtml(HTML, 1)).toHaveLength(1);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchNaverResearch", () => {
  it("HTTP 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) } as Response)));

    const { items, errors } = await fetchNaverResearch();

    expect(items).toEqual([]);
    expect(errors[0]).toContain("네이버금융 리서치 조회 실패");
  });

  it("네트워크 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));

    const { items, errors } = await fetchNaverResearch();

    expect(items).toEqual([]);
    expect(errors[0]).toContain("network down");
  });
});
