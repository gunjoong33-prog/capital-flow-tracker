// 네이버금융 종목 페이지의 "투자의견·목표주가" 컨센서스 섹션 — 국내 다수 증권사(NH·KB·한투 등)
// 평균치를 무료로 공개한다(API 키 불필요). 페이지 구조가 바뀌면 파싱이 0건이 될 수 있으므로
// dataroma.ts와 같은 원칙으로 던지지 않고 errors에 담는다.
export interface BrokerConsensus {
  opinionScore: number; // 1(매도)~5(강력매수) 척도의 평균
  opinionLabel: string; // "매수" 등 텍스트 라벨
  targetPrice: number;
}

export async function fetchBrokerConsensus(ticker: string): Promise<{ consensus: BrokerConsensus | null; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch(`https://finance.naver.com/item/main.naver?code=${ticker}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (capital-flow-tracker personal use)" },
    });
    if (!res.ok) throw new Error(`네이버금융 조회 실패: ${res.status}`);
    const html = await res.text();

    const opinionMatch = html.match(/투자의견<\/em>\s*<span class="num">([\d.]+)([^<]*)<\/span>/);
    const targetMatch = html.match(/목표주가<\/em>\s*<span class="num">([\d,]+)<\/span>/);
    if (!opinionMatch || !targetMatch) {
      errors.push(`네이버금융: ${ticker} 컨센서스 섹션 못 찾음(페이지 구조가 바뀌었을 수 있음)`);
      return { consensus: null, errors };
    }

    return {
      consensus: {
        opinionScore: Number(opinionMatch[1]),
        opinionLabel: opinionMatch[2].trim(),
        targetPrice: Number(targetMatch[1].replace(/,/g, "")),
      },
      errors,
    };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { consensus: null, errors };
  }
}
