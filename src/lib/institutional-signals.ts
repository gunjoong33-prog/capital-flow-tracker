// 7단계 "기관·내부자 매집" 지표 — Dataroma(슈퍼 투자자 13F 활동)·OpenInsider(내부자거래)를 결합해
// 결정론적으로 요약한다. 이미 구조화된 사실 데이터(누가 무엇을 샀다)라 LLM이 필요 없다 —
// 2~6단계 종합판단과 같은 원칙(규칙 기반, 재현 가능). 근거는
// docs/superpowers/specs/2026-07-26-step7-institutional-signals-design.md 참고.
import { fetchSuperInvestorActivity, type SuperInvestorMove } from "@/lib/sources/dataroma";
import { fetchInsiderTrades, type InsiderTrade } from "@/lib/sources/openinsider";
import { SECTOR_ETFS, SECTOR_LABELS } from "@/lib/sources/types";

export interface InstitutionalSignals {
  superInvestorSummary: string;
  stockConsensusSummary: string;
  sectorFlowSummary: string;
  insiderTradeSummary: string;
  activityTickers: string[]; // 매수 쪽 유니크 티커 — 5단계 빅테크 7과 비교용
  topSectorLabel: string | null; // "항공우주(ITA)" 형태 — 6단계 qualifying과 직접 문자열 비교
}

// Yahoo의 표준 섹터명을 우리 10개 카테고리로 대략 매핑한다. Consumer Cyclical·Communication
// Services·Real Estate·Utilities 등은 우리 분류에 대응하는 게 없어 억지로 끼워맞추지 않고 분류 안 함(null)으로 둔다.
const YAHOO_SECTOR_MAP: Record<string, keyof typeof SECTOR_ETFS> = {
  Technology: "TECH_SERVICES",
  "Financial Services": "FINANCE",
  Healthcare: "HEALTHCARE",
  "Consumer Defensive": "STAPLES",
  Energy: "ENERGY",
  "Basic Materials": "MATERIALS",
};

interface YahooSearchResult {
  quotes?: { symbol: string; quoteType: string; sector?: string; industry?: string }[];
}

/** 임의 티커의 GICS 유사 섹터를 Yahoo 검색 API(무료, 크럼 불필요)로 조회해 우리 분류로 매핑한다. */
async function lookupSector(ticker: string): Promise<keyof typeof SECTOR_ETFS | null> {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as YahooSearchResult;
    const quote = data.quotes?.find((q) => q.symbol === ticker && q.quoteType === "EQUITY");
    if (!quote?.sector) return null;
    if (quote.sector === "Industrials") {
      if (quote.industry?.includes("Aerospace")) return "AEROSPACE";
      if (quote.industry?.includes("Defense")) return "DEFENSE";
      return "INDUSTRIALS";
    }
    return YAHOO_SECTOR_MAP[quote.sector] ?? null;
  } catch {
    return null;
  }
}

/** Dataroma의 영문 매매 표기("Buy"·"Sell -100.00%"·"Reduce -21.08%" 등)를 한글로 옮긴다. */
function translateMoveDetail(detail: string, action: "buy" | "sell"): string {
  if (detail === "Buy") return "신규매수";
  const pctMatch = detail.match(/(-?[\d.]+)%/);
  if (!pctMatch) return action === "buy" ? "매수" : "매도";
  const pct = Math.abs(Number(pctMatch[1]));
  if (pct >= 100) return action === "buy" ? "신규매수" : "전량매도";
  return action === "buy" ? `비중 ${pct}% 확대` : `비중 ${pct}% 축소`;
}

// 표 열 너비가 좁아서 줄바꿈이 자주 일어나는데, 그냥 공백이면 "티커(회사명)"처럼 한 덩어리로
// 읽혀야 할 구간이 회사명 중간에서 끊겨 다음 줄로 넘어가 버린다(예: "MOH(Molina Healthcare\nInc.)").
// 줄바꿈 후보가 되는 공백을 줄바꿈 없는 공백(NBSP)으로 바꿔서 이 단위가 항상 붙어 다니게 한다.
function nbsp(s: string): string {
  return s.replace(/ /g, " ");
}

/** DetailTable이 실제값을 "핵심값 — 부가설명"으로 나누는 규칙과 충돌하지 않도록, 문장 내부에는
 *  " — "(em dash)를 절대 쓰지 않는다 — 줄 구분은 "\n"만 쓴다(DetailTable이 whitespace-pre-line으로 살려준다). */
function summarizeSuperInvestors(moves: SuperInvestorMove[]): string {
  if (moves.length === 0) return "확인 못함";
  const notable = [...moves].sort((a, b) => (b.portfolioPct ?? 0) - (a.portfolioPct ?? 0)).slice(0, 4);
  const lines = notable.map((m) => `${m.manager}: ${m.ticker}(${nbsp(m.company)}) ${translateMoveDetail(m.detail, m.action)}`);
  return `최근 분기(${moves[0].quarter}) 고래 매매 중 포트폴리오 비중 변화가 큰 순서:\n${lines.join("\n")}`;
}

function summarizeStockConsensus(moves: SuperInvestorMove[]): string {
  if (moves.length === 0) return "확인 못함";
  const buyCounts = new Map<string, { company: string; managers: Set<string> }>();
  for (const m of moves) {
    if (m.action !== "buy") continue;
    const entry = buyCounts.get(m.ticker) ?? { company: m.company, managers: new Set<string>() };
    entry.managers.add(m.manager);
    buyCounts.set(m.ticker, entry);
  }
  const consensus = [...buyCounts.entries()]
    .filter(([, v]) => v.managers.size >= 2)
    .sort((a, b) => b[1].managers.size - a[1].managers.size)
    .slice(0, 5);
  if (consensus.length === 0) return "이번 분기 2명 이상이 동시 매수한 종목 없음";
  const lines = consensus.map(([ticker, v]) => `${ticker}(${nbsp(v.company)}): ${v.managers.size}명 동시 매수`);
  return `여러 기관이 동시에 사들인 컨센서스 종목:\n${lines.join("\n")}`;
}

function summarizeInsiderTrades(trades: InsiderTrade[]): string {
  const notable = [...trades]
    .filter((t) => t.valueUsd !== null)
    .sort((a, b) => Math.abs(b.valueUsd!) - Math.abs(a.valueUsd!))
    .slice(0, 4);
  if (notable.length === 0) return "확인 못함";
  const lines = notable.map((t) => {
    const actionKo = t.tradeType.startsWith("P") ? "매수" : "매도";
    const amount = `$${Math.abs(t.valueUsd!).toLocaleString("en-US")}`;
    return `${t.ticker}(${nbsp(t.company)}): ${nbsp(t.insiderName)}(${nbsp(t.title)}) ${actionKo} ${amount}`;
  });
  return `금액 기준 최근 대형 내부자거래:\n${lines.join("\n")}`;
}

async function summarizeSectorFlow(
  superMoves: SuperInvestorMove[],
  insiderTrades: InsiderTrade[]
): Promise<{ summary: string; topSectorKey: keyof typeof SECTOR_ETFS | null }> {
  const buyTickerCounts = new Map<string, number>();
  for (const m of superMoves) {
    if (m.action === "buy") buyTickerCounts.set(m.ticker, (buyTickerCounts.get(m.ticker) ?? 0) + 1);
  }
  for (const t of insiderTrades) {
    if (t.tradeType.startsWith("P")) buyTickerCounts.set(t.ticker, (buyTickerCounts.get(t.ticker) ?? 0) + 1);
  }

  // Yahoo 호출 횟수를 억제하려고 매수 빈도 상위 10종목만 섹터 조회한다.
  const topTickers = [...buyTickerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);
  if (topTickers.length === 0) return { summary: "확인 못함", topSectorKey: null };

  const sectors = await Promise.all(topTickers.map((t) => lookupSector(t)));
  const sectorCounts = new Map<keyof typeof SECTOR_ETFS, number>();
  sectors.forEach((s) => {
    if (s) sectorCounts.set(s, (sectorCounts.get(s) ?? 0) + 1);
  });

  if (sectorCounts.size === 0) return { summary: "매수 상위 종목의 섹터 분류 안 됨", topSectorKey: null };
  const [topSectorKey, count] = [...sectorCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const label = `${SECTOR_LABELS[topSectorKey]}(${SECTOR_ETFS[topSectorKey]})`;
  return {
    summary: `최근 매수 상위 ${topTickers.length}종목 중 ${count}종목이 ${label} 섹터로 가장 많이 몰림`,
    topSectorKey,
  };
}

/** Dataroma·OpenInsider를 병렬로 가져와 7단계용 5개 요약을 만든다. 하루 1회(파이프라인)만 호출한다. */
export async function computeInstitutionalSignals(): Promise<{ signals: InstitutionalSignals; errors: string[] }> {
  const errors: string[] = [];
  const [{ moves, errors: dataromaErrors }, { trades, errors: openinsiderErrors }] = await Promise.all([
    fetchSuperInvestorActivity(),
    fetchInsiderTrades(),
  ]);
  errors.push(...dataromaErrors, ...openinsiderErrors);

  const superInvestorSummary = summarizeSuperInvestors(moves);
  const stockConsensusSummary = summarizeStockConsensus(moves);
  const insiderTradeSummary = summarizeInsiderTrades(trades);
  const { summary: sectorFlowSummary, topSectorKey } = await summarizeSectorFlow(moves, trades);

  const activityTickers = [
    ...new Set([
      ...moves.filter((m) => m.action === "buy").map((m) => m.ticker),
      ...trades.filter((t) => t.tradeType.startsWith("P")).map((t) => t.ticker),
    ]),
  ];

  return {
    signals: {
      superInvestorSummary,
      stockConsensusSummary,
      sectorFlowSummary,
      insiderTradeSummary,
      activityTickers,
      topSectorLabel: topSectorKey ? `${SECTOR_LABELS[topSectorKey]}(${SECTOR_ETFS[topSectorKey]})` : null,
    },
    errors,
  };
}
