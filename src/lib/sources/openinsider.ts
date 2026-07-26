// SEC Form 4 기반 내부자거래 — openinsider.com은 sec.gov 원본 공시를 재가공한 무료 스크리너.
// robots.txt가 알려진 SEO봇(Semrush 등)만 막고 일반 요청은 허용한다. 순수 서버 렌더링 HTML 표.
import { decodeXmlEntities } from "./news-feeds";

export interface InsiderTrade {
  ticker: string;
  company: string;
  insiderName: string;
  title: string;
  tradeType: string; // "P - Purchase" | "S - Sale" | "S - Sale+OE" 등 원문 그대로
  valueUsd: number | null; // 음수면 매도, 양수면 매수 규모(달러)
  filingDate: string;
}

function parseTrades(html: string): InsiderTrade[] {
  const start = html.indexOf('class="tinytable"');
  if (start === -1) return [];
  const rows = html.slice(start).match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];

  const trades: InsiderTrade[] = [];
  for (const row of rows) {
    if (row.includes("<h3>")) continue; // 헤더 행

    const tickerMatch = row.match(/<a href="\/([A-Z.]+)" onmouseover/);
    const companyMatch = row.match(/<a href="\/[A-Z.]+">([^<]+)<\/a>/);
    const insiderMatch = row.match(/<a href="\/insider\/[^"]*"[^>]*>([^<]+)<\/a>/);
    const filingDateMatch = row.match(/title="SEC Form 4"[^>]*>([^<]+)<\/a>/);
    const titleTypeMatch = row.match(/<\/a><\/td><td>([^<]*)<\/td><td>([A-Z] - [^<]+)<\/td>/);
    if (!tickerMatch || !insiderMatch || !titleTypeMatch) continue;

    // Trade Type 셀 뒤로 Price, Qty, Owned, ΔOwn, Value, 1d, 1w, 1m, 6m 순서로 align=right 셀이 이어진다.
    const rest = row.slice(row.indexOf(titleTypeMatch[0]) + titleTypeMatch[0].length);
    const rightCells = [...rest.matchAll(/<td align=right>([^<]*)<\/td>/g)].map((m) => m[1]);
    const valueRaw = rightCells[4] ?? "";
    const valueMatch = valueRaw.replace(/[$,]/g, "").match(/-?\d+/);

    trades.push({
      ticker: tickerMatch[1],
      company: companyMatch ? decodeXmlEntities(companyMatch[1].trim()) : tickerMatch[1],
      insiderName: decodeXmlEntities(insiderMatch[1].trim()),
      title: titleTypeMatch[1].trim(),
      tradeType: titleTypeMatch[2].trim(),
      valueUsd: valueMatch ? Number(valueMatch[0]) : null,
      filingDate: filingDateMatch ? filingDateMatch[1].trim() : "",
    });
  }
  return trades;
}

/** 최신 내부자거래(SEC Form 4) 상위 100건을 가져온다. 실패 시 빈 배열 + 에러. */
export async function fetchInsiderTrades(): Promise<{ trades: InsiderTrade[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch("http://openinsider.com/latest-insider-trading", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 (capital-flow-tracker personal use)",
      },
    });
    if (!res.ok) throw new Error(`OpenInsider 조회 실패: ${res.status}`);
    const html = await res.text();
    const trades = parseTrades(html);
    if (trades.length === 0) errors.push("OpenInsider: 거래 데이터 파싱 결과 0건(페이지 구조가 바뀌었을 수 있음)");
    return { trades, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { trades: [], errors };
  }
}
