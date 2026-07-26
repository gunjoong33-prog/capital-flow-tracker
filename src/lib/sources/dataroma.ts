// 슈퍼 투자자(버핏 등 80여 명) 13F 최근 매매 활동 — dataroma.com은 순수 서버 렌더링 HTML(SPA 아님)이고
// robots.txt 제한이 없는 무료 공개 도구다(FolioObs처럼 백엔드 우회가 아니라 그냥 공개 페이지 파싱).
// WhaleWisdom·FolioObs 자동화를 검토하다 기각하고 찾은 대안 — 근거는
// docs/superpowers/specs/2026-07-26-step7-institutional-signals-design.md 참고.
import { decodeXmlEntities } from "./news-feeds";

export interface SuperInvestorMove {
  manager: string;
  ticker: string;
  company: string;
  action: "buy" | "sell";
  detail: string; // "Buy" | "Reduce -21.08%" | "Sell -100.00%" 등 원문 그대로
  portfolioPct: number | null; // 이 종목이 매니저 포트폴리오에서 차지하는 비중 변화(%) — 중요도 랭킹용
  quarter: string;
}

/** 활동 표의 각 매니저(행)를 "<td class="firm">" 시작 기준으로 잘라낸다. */
function splitRowBlocks(html: string): string[] {
  return html.match(/<td class="firm">[\s\S]*?(?=<td class="firm">|<\/table>)/g) ?? [];
}

function parseMoves(html: string): SuperInvestorMove[] {
  const moves: SuperInvestorMove[] = [];
  for (const block of splitRowBlocks(html)) {
    const managerMatch = block.match(/<a[^>]*>([^<]+)<\/a>/);
    const quarterMatch = block.match(/<td class="period">([^<]+)<\/td>/);
    if (!managerMatch || !quarterMatch) continue;
    const manager = decodeXmlEntities(managerMatch[1].trim());
    const quarter = quarterMatch[1].trim();

    const moveBlocks = block.match(/<a class="(?:buy|sell)"[^>]*>[\s\S]*?<\/div>/g) ?? [];
    for (const mv of moveBlocks) {
      const actionMatch = mv.match(/<a class="(buy|sell)" href="[^"]*sym=([^&"]+)/);
      const detailMatch = mv.match(/<div>([^<]+)<br\/>([^<]+)<br\/>([^<]+)<\/div>/);
      if (!actionMatch || !detailMatch) continue;
      const pctMatch = detailMatch[3].match(/([\d.]+)%/);
      moves.push({
        manager,
        ticker: actionMatch[2],
        company: decodeXmlEntities(detailMatch[1].trim()),
        action: actionMatch[1] as "buy" | "sell",
        detail: detailMatch[2].trim(),
        portfolioPct: pctMatch ? Number(pctMatch[1]) : null,
        quarter,
      });
    }
  }
  return moves;
}

/** 슈퍼 투자자 최근 활동(신규매수·전량매도·비중 확대/축소) 전체를 가져온다. 실패 시 빈 배열 + 에러. */
export async function fetchSuperInvestorActivity(): Promise<{ moves: SuperInvestorMove[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch("https://www.dataroma.com/m/allact.php?typ=a", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 (capital-flow-tracker personal use)",
      },
    });
    if (!res.ok) throw new Error(`Dataroma 조회 실패: ${res.status}`);
    const html = await res.text();
    const moves = parseMoves(html);
    if (moves.length === 0) errors.push("Dataroma: 활동 데이터 파싱 결과 0건(페이지 구조가 바뀌었을 수 있음)");
    return { moves, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { moves: [], errors };
  }
}
