// 한국은행 경제전망보고서 — 로그인·키 불필요, 완전 공개(실측 확인, 2026-09). 목록 자체는 첫
// 로드 시 빈 셸(`<div id="bbsList"></div>`)이고 실제 데이터는 POST AJAX로 채워진다.
// menuNo만 보내면 다른 게시물이 섞이는데, depth/depth2/depth3(3단계 메뉴 계층 코드)까지 함께
// 보내야만 "경제전망보고서"로 정확히 필터링된다(실측 확인 — 이 조합이 유일하게 맞는 값).
const LIST_URL = "https://www.bok.or.kr/portal/singl/newsData/listCont.do";
const LIST_BODY = "depth=201150&depth2=200699&depth3=200066&menuNo=200066&searchCnd=1&sort=1&pageIndex=1&pageUnit=1";
const USER_AGENT = "Mozilla/5.0 (capital-flow-tracker personal use)";

export interface BokReport {
  title: string;
  url: string;
}

/** 목록 AJAX 응답에서 가장 최근 1건의 게시물 번호(nttId)·제목을 뽑는다. 제목 앞에 종종
 * `<!-- 공지 배지 --><span> -->` 형태의 HTML 주석이 끼어 있어(공지 여부 표시용) 건너뛴다. */
export function parseBokListHtml(html: string): { nttId: string; title: string } | null {
  const m = html.match(/nttId=(\d+)[^"]*"[^>]*class="title">\s*(?:<!--[\s\S]*?-->)?\s*([^<]+)/);
  return m ? { nttId: m[1], title: m[2].trim() } : null;
}

/** 상세 페이지 본문에서 첫 번째 PDF 첨부 링크를 뽑는다. */
export function parseBokDetailHtml(html: string): string | null {
  const m = html.match(/href="(\/fileSrc\/[^"]+\.pdf)"/);
  return m ? `https://www.bok.or.kr${m[1]}` : null;
}

/** 최신 경제전망보고서 1건(제목 + PDF 링크)을 가져온다. PDF를 못 찾으면 상세 페이지 URL로
 * 대체한다. 실패해도 던지지 않고 errors에 담는다. */
export async function fetchBokEconomicOutlook(): Promise<{ report: BokReport | null; errors: string[] }> {
  const errors: string[] = [];
  try {
    const listRes = await fetch(LIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: LIST_BODY,
    });
    if (!listRes.ok) throw new Error(`한국은행 경제전망보고서 목록 조회 실패: ${listRes.status}`);
    const latest = parseBokListHtml(await listRes.text());
    if (!latest) {
      errors.push("한국은행 경제전망보고서: 목록에서 항목 못 찾음(페이지 구조가 바뀌었을 수 있음)");
      return { report: null, errors };
    }

    const detailUrl = `https://www.bok.or.kr/portal/bbs/P0002359/view.do?nttId=${latest.nttId}&menuNo=200066`;
    const detailRes = await fetch(detailUrl, { headers: { "User-Agent": USER_AGENT } });
    if (!detailRes.ok) throw new Error(`한국은행 경제전망보고서 상세(${latest.nttId}) 조회 실패: ${detailRes.status}`);
    const pdfUrl = parseBokDetailHtml(await detailRes.text());

    return { report: { title: latest.title, url: pdfUrl ?? detailUrl }, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { report: null, errors };
  }
}
