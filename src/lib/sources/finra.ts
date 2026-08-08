// FINRA Reg SHO 일별 공매도 거래량 파일(무료, 키 불필요) — 기관의 공매도 압력을 개인이 보기 힘든
// "거래대금 대비 공매도 비중"으로 근사한다. 순수 다크풀 비중(ATS 거래소외 거래량)과는 다른 지표라
// 혼동하지 않는다 — 여기서 얻는 건 "이 거래가 공매도로 체결됐는가"의 비율이다.
// 파일은 거래일 다음 영업일 새벽에 올라오고, 주말·휴장일엔 없다(403) — 최근 거래일을 찾을 때까지
// 며칠 거슬러 올라간다.
export interface ShortVolumeRow {
  ticker: string;
  shortVolume: number;
  totalVolume: number;
  ratio: number; // shortVolume / totalVolume
}

const BASE_URL = "https://cdn.finra.org/equity/regsho/daily/CNMSshvol";

function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function parseFile(text: string, tickers: readonly string[]): Map<string, ShortVolumeRow> {
  const wanted = new Set(tickers);
  const result = new Map<string, ShortVolumeRow>();
  const lines = text.split("\n");
  for (const line of lines) {
    const cols = line.split("|");
    if (cols.length < 5) continue;
    const [, symbol, shortVolStr, , totalVolStr] = cols;
    if (!wanted.has(symbol)) continue;
    const shortVolume = parseFloat(shortVolStr);
    const totalVolume = parseFloat(totalVolStr);
    if (!Number.isFinite(shortVolume) || !Number.isFinite(totalVolume) || totalVolume === 0) continue;
    result.set(symbol, { ticker: symbol, shortVolume, totalVolume, ratio: shortVolume / totalVolume });
  }
  return result;
}

/** referenceDate부터 최대 maxLookback일 거슬러 올라가며 가장 최근에 존재하는 파일을 찾아 파싱한다. */
export async function fetchShortVolumeRatios(
  tickers: readonly string[],
  referenceDate: Date = new Date(),
  maxLookback = 7
): Promise<{ rows: Map<string, ShortVolumeRow>; fileDate: string | null; errors: string[] }> {
  const errors: string[] = [];
  for (let i = 0; i < maxLookback; i++) {
    const d = new Date(referenceDate);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = toYYYYMMDD(d);
    try {
      const res = await fetch(`${BASE_URL}${dateStr}.txt`);
      if (!res.ok) continue;
      const text = await res.text();
      const rows = parseFile(text, tickers);
      if (rows.size === 0) continue;
      return { rows, fileDate: dateStr, errors };
    } catch (err) {
      errors.push(`FINRA ${dateStr}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  errors.push(`FINRA 공매도거래량: 최근 ${maxLookback}일 내 파일을 찾지 못함`);
  return { rows: new Map(), fileDate: null, errors };
}
