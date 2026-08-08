// 7단계 "기관·내부자 매집" 지표 — Dataroma(슈퍼 투자자 13F 활동)·OpenInsider(내부자거래)를 결합해
// 결정론적으로 요약한다. 이미 구조화된 사실 데이터(누가 무엇을 샀다)라 LLM이 필요 없다 —
// 2~6단계 종합판단과 같은 원칙(규칙 기반, 재현 가능). 근거는
// docs/superpowers/specs/2026-07-26-step7-institutional-signals-design.md 참고.
import { fetchSuperInvestorActivity, type SuperInvestorMove } from "@/lib/sources/dataroma";
import { fetchInsiderTrades, type InsiderTrade } from "@/lib/sources/openinsider";
import { fetchShortVolumeRatios, type ShortVolumeRow } from "@/lib/sources/finra";
import { fetchEquityDisclosures, type DartFiling } from "@/lib/sources/dart";
import { BIG_TECH_LABELS, SECTOR_ETFS, SECTOR_LABELS } from "@/lib/sources/types";

export interface InstitutionalSignals {
  superInvestorSummary: string;
  stockConsensusSummary: string;
  sectorFlowSummary: string;
  insiderTradeSummary: string;
  shortVolumeSummary: string;
  domesticFilingSummary: string;
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

/** detail 문자열("Reduce -95.40%" 등)에서 절대값 퍼센트만 뽑는다. */
function parseDetailPct(detail: string): number | null {
  const m = detail.match(/(-?[\d.]+)%/);
  return m ? Math.abs(Number(m[1])) : null;
}

/** 같은 매니저가 한 분기에 3종목 이상에서 90% 이상 비슷한 폭으로 줄이면(또는 늘리면), 개별 종목에 대한
 *  판단이 아니라 "포트폴리오 전체 리셋·청산·13F 제출 방식 변경" 신호일 가능성이 높다 — 예를 들어
 *  William Von Mueffling(Cantillon)이 한 분기에 10종목을 전부 ~95% 줄인 경우, 이걸 "이 종목이
 *  안 좋아 보인다"는 종목별 시그널로 읽으면 안 된다. */
function isPortfolioWideReset(managerMoves: SuperInvestorMove[]): boolean {
  const bigMoves = managerMoves.filter((m) => {
    const pct = parseDetailPct(m.detail);
    return pct !== null && pct >= 90;
  });
  return bigMoves.length >= 3;
}

/** DetailTable이 실제값을 "핵심값 — 부가설명"으로 나누는 규칙과 충돌하지 않도록, 문장 내부에는
 *  " — "(em dash)를 절대 쓰지 않는다 — 줄 구분은 "\n"만 쓴다(DetailTable이 whitespace-pre-line으로 살려준다). */
function summarizeSuperInvestors(moves: SuperInvestorMove[]): string {
  if (moves.length === 0) return "확인 못함";

  // 같은 매니저가 여러 종목에 몰려 "포트폴리오 비중 변화 상위 N개"를 혼자 독점하는 걸 막는다
  // (Von Mueffling처럼 한 매니저가 10종목 전부 큰 비중 변화를 보이면 "고래 동향"으로서 정보량이
  // 0이 된다) — 매니저당 비중 변화가 가장 큰 종목 1개만 후보로 남긴다.
  const byManager = new Map<string, SuperInvestorMove[]>();
  for (const m of moves) {
    const arr = byManager.get(m.manager) ?? [];
    arr.push(m);
    byManager.set(m.manager, arr);
  }

  const candidates = [...byManager.values()].map((managerMoves) => {
    const top = [...managerMoves].sort((a, b) => (b.portfolioPct ?? 0) - (a.portfolioPct ?? 0))[0];
    // 매니저 전체에 리셋 패턴이 있어도, 지금 뽑힌 top 자체가 그 패턴(≥90% 변화)에 안 속하면
    // (예: 리셋과 무관한 별도 신규매수 1건) 경고를 붙이지 않는다 — 경고는 "이 특정 종목 변화가
    // 리셋의 일부"일 때만 의미가 있다.
    const topPct = parseDetailPct(top.detail);
    const resetWarning = (topPct !== null && topPct >= 90) && isPortfolioWideReset(managerMoves);
    return { top, resetWarning };
  });

  const notable = candidates.sort((a, b) => (b.top.portfolioPct ?? 0) - (a.top.portfolioPct ?? 0)).slice(0, 4);
  const lines = notable.map(({ top: m, resetWarning }) => {
    const base = `${m.manager}: ${m.ticker}(${nbsp(m.company)}) ${translateMoveDetail(m.detail, m.action)}`;
    return resetWarning
      ? `${base} (같은 매니저가 여러 종목에서 동시에 급변 — 종목별 시그널이 아니라 포트폴리오 전체 리셋·청산 가능성)`
      : base;
  });
  return `최근 분기(${moves[0].quarter}) 고래 매매 중 포트폴리오 비중 변화가 큰 순서(매니저당 1건):\n${lines.join("\n")}\n※ 13F는 분기 마감 후 최대 45일 내 제출이라 "${moves[0].quarter}" 데이터는 이미 1~4개월 지난 정보일 수 있습니다.`;
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

/** FINRA 공매도거래량 파일에서 빅테크 7 종목만 골라 비중을 요약한다. 순수 다크풀 비중이 아니라
 * "그날 체결된 거래 중 공매도로 표시된 비중"이다 — 잔고가 아니라 거래 흐름 지표라는 점을 라벨에
 * 명시해서 KRX 공매도 잔고비중(별도 지표, 미구현)과 혼동되지 않게 한다. */
function summarizeShortVolume(rows: Map<string, ShortVolumeRow>, fileDate: string | null): string {
  if (rows.size === 0) return "확인 못함";
  const sorted = [...rows.values()].sort((a, b) => b.ratio - a.ratio);
  const dateLabel = fileDate ? `${fileDate.slice(0, 4)}-${fileDate.slice(4, 6)}-${fileDate.slice(6, 8)}` : "확인 못함";
  const lines = sorted.map((r) => {
    const label = BIG_TECH_LABELS[r.ticker] ? `${BIG_TECH_LABELS[r.ticker]}(${r.ticker})` : r.ticker;
    return `${label}: ${(r.ratio * 100).toFixed(1)}%`;
  });
  return `${dateLabel} 거래대금 중 공매도 비중(FINRA, 거래일 T+1 지연):\n${lines.join("\n")}`;
}

/** DART 지분공시(대량보유·임원소유) 요약 — 절대값 변동폭이 큰 순서로 최대 4건. */
function summarizeDomesticFilings(filings: DartFiling[]): string {
  if (filings.length === 0) return "확인 못함";
  const notable = [...filings]
    .sort((a, b) => Math.abs(b.stakePctChange ?? 0) - Math.abs(a.stakePctChange ?? 0))
    .slice(0, 4);
  const lines = notable.map((f) => {
    const typeKo = f.type === "major" ? "대량보유" : "임원·주요주주";
    const pct = f.stakePct !== null ? `${f.stakePct.toFixed(2)}%` : "확인 못함";
    const change =
      f.stakePctChange !== null ? `(${f.stakePctChange >= 0 ? "+" : ""}${f.stakePctChange.toFixed(2)}%p)` : "";
    return `${nbsp(f.corpName)}(${typeKo}): ${nbsp(f.filerName)} 지분 ${pct}${change}`;
  });
  return `오늘 지분공시 중 변동폭 큰 순서(DART):\n${lines.join("\n")}`;
}

/** Dataroma·OpenInsider·FINRA·DART를 병렬로 가져와 7단계용 요약을 만든다. 하루 1회(파이프라인)만 호출한다. */
export async function computeInstitutionalSignals(
  bigTechTickers: readonly string[] = [],
  dartApiKey?: string
): Promise<{ signals: InstitutionalSignals; errors: string[] }> {
  const errors: string[] = [];
  const [{ moves, errors: dataromaErrors }, { trades, errors: openinsiderErrors }, shortVolResult, dartResult] = await Promise.all([
    fetchSuperInvestorActivity(),
    fetchInsiderTrades(),
    bigTechTickers.length > 0 ? fetchShortVolumeRatios(bigTechTickers) : Promise.resolve({ rows: new Map<string, ShortVolumeRow>(), fileDate: null, errors: [] }),
    dartApiKey ? fetchEquityDisclosures(dartApiKey) : Promise.resolve({ filings: [] as DartFiling[], errors: [] as string[] }),
  ]);
  errors.push(...dataromaErrors, ...openinsiderErrors, ...shortVolResult.errors, ...dartResult.errors);

  const superInvestorSummary = summarizeSuperInvestors(moves);
  const stockConsensusSummary = summarizeStockConsensus(moves);
  const insiderTradeSummary = summarizeInsiderTrades(trades);
  const shortVolumeSummary = summarizeShortVolume(shortVolResult.rows, shortVolResult.fileDate);
  const domesticFilingSummary = summarizeDomesticFilings(dartResult.filings);
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
      shortVolumeSummary,
      domesticFilingSummary,
      activityTickers,
      topSectorLabel: topSectorKey ? `${SECTOR_LABELS[topSectorKey]}(${SECTOR_ETFS[topSectorKey]})` : null,
    },
    errors,
  };
}
