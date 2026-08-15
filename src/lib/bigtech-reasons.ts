// 빅테크 7(Magnificent 7) 개별 종목의 오늘 등락 원인 판정 — 가볍고 빈도 낮은 판정이라 속도가
// 빠른 Groq를 쓴다(llm-clients.ts 주석 참고 — Mistral은 품질이 더 중요한 news-events.ts·
// narrative.ts에 우선 배정). 종목 7개를 한 프롬프트에 묶어 하루 1회만 호출한다.
import { getMetricHistoryByCount } from "@/lib/metrics";
import { fetchBigTechHeadlines, type Headline } from "@/lib/sources/news-feeds";
import { BIG_TECH_LABELS } from "@/lib/sources/types";
import { callGroq, extractJsonArray } from "@/lib/llm-clients";

async function change1dFor(ticker: string, asOf: Date): Promise<number | null> {
  const history = await getMetricHistoryByCount(ticker, 2, asOf);
  if (history.length < 2) return null;
  const [prev, curr] = history;
  return prev.value !== 0 ? ((curr.value - prev.value) / prev.value) * 100 : null;
}

async function judgeBigTechReasons(
  changes: { ticker: string; changePct1d: number | null }[],
  headlinesByTicker: Record<string, Headline[]>
): Promise<Record<string, string>> {
  if (!process.env.GROQ_API_KEY) return {};

  const sections = changes
    .map(({ ticker, changePct1d }) => {
      const label = BIG_TECH_LABELS[ticker] ?? ticker;
      const changeStr = changePct1d !== null ? `${changePct1d >= 0 ? "+" : ""}${changePct1d.toFixed(2)}%` : "확인 못함";
      const heads = headlinesByTicker[ticker] ?? [];
      // 발행일을 같이 보여준다 — 예전엔 제목만 줘서, "지난 6월 JPMorgan이 목표주가를 상향했다"처럼
      // 옛 사건을 회고 언급만 하는 최신 기사를 오늘의 등락 원인으로 잘못 지목한 사례가 실제로
      // 있었다(테슬라 상승 원인을 두 달 전 애널리스트 리포트로 서술). 기사 발행일과 기사가 다루는
      // 사건 시점이 다를 수 있다는 걸 프롬프트에서 명시적으로 경고한다.
      const list =
        heads.length > 0
          ? heads.map((h, i) => `  ${i + 1}. [발행: ${h.publishedAt ?? "날짜 확인 안 됨"}] ${h.title}`).join("\n")
          : "  (관련 뉴스 없음)";
      return `${ticker}(${label}) 전일 대비 ${changeStr}\n${list}`;
    })
    .join("\n\n");

  const prompt = `너는 주식 시장 분석가다. 아래는 오늘 미국 빅테크 종목들의 전일 대비 등락률과 관련 뉴스 헤드라인(발행일 포함)이다.
각 종목마다 오늘 등락의 원인을 헤드라인 근거로 한국어 1문장으로 요약해라.
문장은 반드시 존댓말(합쇼체, "~습니다"/"~했습니다"체)로 끝내라 — "~다", "~았다/었다" 같은 평서체는 쓰지 마라.
헤드라인에 등락 원인이 될 만한 내용이 없으면 반드시 "명확한 원인 확인 안 됨"이라고만 써라 — 뉴스에 없는 원인을 지어내지 마라.

*** 중요: 기사가 "오늘 새로 일어난 일"을 보도하는지, 아니면 몇 주·몇 달 전 사건을 배경 설명으로
회고 언급만 하는지 반드시 구분해라. "지난 6월 상향했다", "앞서 발표한", "그동안" 같은 표현으로 옛
사건을 언급하는 기사는 오늘 등락의 직접 원인으로 쓰지 마라 — 최근(발행일 기준 1~2일 이내) 새로
발생한 사건·발표·실적만 원인으로 인정해라. 기사 발행일이 최근이어도 다루는 사건 자체가 오래됐으면
회고 기사로 간주해라. 그런 기사밖에 없으면 "명확한 원인 확인 안 됨"이라고 써라. ***

*** 중요: 기사가 그 회사 자체의 결정·실적(자사 발표, 자체 매출·실적 발표, 신제품, 소송 등)을
다루는지, 아니면 정부 통계·업계 전반 지표(예: 소매판매 발표, 물가지표 등)를 다루면서 그 회사를
사례로 언급만 하는지 구분해라. 후자의 경우 "OO 자체 매출이 줄었다"처럼 회사 고유의 실적 악화인
것처럼 쓰지 마라 — "OO도 소매판매 통계 부진의 영향권"처럼 원인이 회사 개별 실적이 아니라
업계·거시 통계라는 점을 그대로 드러내라. 통계 하락이 타이밍 효과(예: 행사 시기 이동) 때문이라고
기사에 나와 있으면 그 설명도 반드시 포함해라. ***

각 항목에 대해 아래 JSON 배열 형식으로만 답해라. 다른 텍스트는 쓰지 마라:
[{"ticker": "AAPL", "reason": "한국어 1문장"}]

종목 목록:
${sections}`;

  // gpt-oss-120b는 내부적으로 thinking 모델이라 reasoning_effort를 낮춰(low) 답변 예산을
  // 추론에 뺏기지 않게 한다 — 헤드라인·등락률을 보고 1문장 요약하는 단순 판단이라 깊은 추론이
  // 필요 없다("none"은 이 모델이 거부해서 최소값인 "low"를 쓴다).
  const text = await callGroq(prompt, { maxTokens: 4096, reasoningEffort: "low" });
  const parsed = extractJsonArray<{ ticker: string; reason: string }>(text);
  if (!parsed) return {};

  const result: Record<string, string> = {};
  for (const p of parsed) result[p.ticker] = p.reason;
  return result;
}

/**
 * 빅테크 7 등락 원인을 판정해 티커별 한 줄 이유를 반환한다. pipeline.ts·refresh-report.ts에서 호출해
 * runDailyAnalysis()에 넘긴다(run.ts 자체는 DB 읽기만 하도록 LLM 호출과 분리 — news-events.ts와 같은 원칙).
 *
 * asOf(=marketDate)를 반드시 넘겨야 한다 — 안 넘기면 등락률·뉴스 검색 둘 다 실행 시각("지금") 기준이
 * 돼서, 주말·휴장일 지나 파이프라인이 도는 날엔 리포트가 다루는 거래일과 다른 뉴스를 찾아온다
 * (institutional-signals.ts의 FINRA/DART/KRX/Put-Call에서 실제로 겪은 것과 같은 버그 클래스).
 */
export async function computeBigTechReasons(
  tickers: readonly string[],
  asOf: Date = new Date()
): Promise<{ reasons: Record<string, string>; errors: string[] }> {
  const errors: string[] = [];
  const changes = await Promise.all(
    tickers.map(async (ticker) => ({ ticker, changePct1d: await change1dFor(ticker, asOf) }))
  );

  const { byTicker, errors: fetchErrors } = await fetchBigTechHeadlines(asOf);
  errors.push(...fetchErrors);

  let reasons: Record<string, string> = {};
  try {
    reasons = await judgeBigTechReasons(changes, byTicker);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { reasons, errors };
}
