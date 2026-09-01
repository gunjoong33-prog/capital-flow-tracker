import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBisQuarterlyReview, parseBisIndexHtml, parseBisIssueHtml } from "./bis-quarterly-review";

// 픽스처는 2026-09-01 실측 bis.org/publications/qr, bis.org/publications/qr-202606 응답 구조를
// 그대로 축약함(index 페이지는 발행호 링크만, 발행호 페이지는 card-wrapper 블록만 남김).
const INDEX_HTML = `<nav>
<a href="/publications/qr" class="">Quarterly Review</a>
<a href="/publications/qr-202603">Mar 2026</a>
<a href="/publications/qr-202606">Jun 2026</a>
<a href="/publications/qr-202512">Dec 2025</a>
</nav>`;

const ISSUE_HTML = `<div class="card-wrapper single-component">
<a href="/publications/central-banks-lending-operations" class="card-link">
<span class="card-date fs-sm">15 Jun 2026</span>
<h5 class="card-heading">The evolution of central banks&#039; lending operations</h5>
</a>
</div>
<div class="card-wrapper single-component">
<a href="/publications/fx-settlement-risk" class="card-link">
<span class="card-date fs-sm">15 Jun 2026</span>
<h5 class="card-heading">Uncovering FX settlement risk</h5>
</a>
</div>
<div class="card-wrapper single-component">
<a href="/publications/bulletin" class="card-link">
<h5 class="card-heading">Bulletin (no date — should be skipped)</h5>
</a>
</div>`;

describe("parseBisIndexHtml", () => {
  it("발행호 슬러그 중 문자열 정렬 최댓값(최신호)을 반환한다", () => {
    expect(parseBisIndexHtml(INDEX_HTML)).toBe("qr-202606");
  });

  it("발행호 링크가 없으면 null을 반환한다", () => {
    expect(parseBisIndexHtml("<div></div>")).toBeNull();
  });
});

describe("parseBisIssueHtml", () => {
  it("날짜가 있는 카드만 파싱하고 HTML 숫자 엔티티(아포스트로피)를 디코딩한다", () => {
    const articles = parseBisIssueHtml(ISSUE_HTML, 5);

    expect(articles).toHaveLength(2);
    expect(articles[0]).toEqual({
      title: "The evolution of central banks' lending operations",
      url: "https://www.bis.org/publications/central-banks-lending-operations",
      publishedAt: "15 Jun 2026",
    });
  });

  it("limit으로 건수를 제한한다", () => {
    expect(parseBisIssueHtml(ISSUE_HTML, 1)).toHaveLength(1);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchBisQuarterlyReview", () => {
  it("색인에서 최신 발행호를 찾은 뒤 그 발행호의 기사를 반환한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const html = url.endsWith("/qr") ? INDEX_HTML : ISSUE_HTML;
        return Promise.resolve({ ok: true, text: () => Promise.resolve(html) } as Response);
      })
    );

    const { articles, errors } = await fetchBisQuarterlyReview(5);

    expect(errors).toEqual([]);
    expect(articles).toHaveLength(2);
  });

  it("색인 조회 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, text: () => Promise.resolve("") } as Response)));

    const { articles, errors } = await fetchBisQuarterlyReview();

    expect(articles).toEqual([]);
    expect(errors[0]).toContain("BIS Quarterly Review 색인 조회 실패");
  });
});
