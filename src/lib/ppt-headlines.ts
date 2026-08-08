// 홈 화면 PPT 슬라이드 카드의 훅 헤드라인만 LLM으로 짓는다(숫자·사실은 ppt-slides.ts가 이미 결정론적
// 으로 확정). bigtech-reasons.ts와 같은 원칙 — 가볍고 빈도 낮은 판단이라 빠른 Groq를 쓰고, 9개
// 슬라이드를 한 프롬프트로 묶어 한 번만 호출한다. 프롬프트에는 kicker·body(둘 다 이미 확정된 사실
// 문장)만 넘기고 원본 숫자는 아예 안 준다 — 숫자를 안 주면 잘못 옮겨 적을 수도 없다. 그래도 혹시
// 모델이 body에 있던 숫자를 헤드라인에 베껴 쓰면(예: "148건의 뉴스가...") 그 슬라이드만 kicker로
// 폴백한다 — 화면에 카드가 아예 안 뜨는 것보단 안전(데이터 정직성 원칙).
import { callGroq, extractJsonArray } from "@/lib/llm-clients";
import type { PptSlide } from "@/lib/scoring/types";

interface HeadlineResponse {
  step: number;
  headline: string;
}

export async function generatePptHeadlines(slides: PptSlide[]): Promise<Record<number, string>> {
  const fallback: Record<number, string> = {};
  for (const s of slides) fallback[s.step] = s.kicker;

  const sections = slides.map((s) => `${s.step}번: ${s.kicker} — ${s.body}`).join("\n");
  const prompt = `너는 경제 매거진의 카드뉴스 헤드라인 카피라이터다. 아래는 오늘 발행할 카드뉴스
9장의 사실 요약이다. 각 장마다 훅이 있는 한국어 헤드라인을 한 줄(15자 내외, 최대 2줄)로 지어라.

*** 절대 규칙: 헤드라인에 숫자를 쓰지 마라(아라비아 숫자, %, bp 등 전부 금지) ***
숫자는 카드의 다른 자리에서 이미 정확히 보여주므로, 헤드라인은 "왜 중요한지"를 숫자 없이 압축하는
역할만 한다. 예시 톤(참고용, 그대로 베끼지 말 것): "스프레드는 위험한데 엔화는 왜 조용한가",
"같은 날, 정반대로 움직인 두 종목", "숫자보다 뉴스가 이긴 하루".
존댓말(합니다체) 쓰지 마라 — 명사구나 짧은 평서형으로 끝내라.

아래 JSON 배열 형식으로만 답해라. 다른 텍스트는 쓰지 마라:
[{"step": 1, "headline": "한국어 헤드라인"}]

카드 목록:
${sections}`;

  let text: string;
  try {
    text = await callGroq(prompt, { maxTokens: 1024, reasoningEffort: "low" });
  } catch {
    return fallback;
  }

  const parsed = extractJsonArray<HeadlineResponse>(text);
  if (!parsed) return fallback;

  const result = { ...fallback };
  for (const item of parsed) {
    if (typeof item.step !== "number" || typeof item.headline !== "string") continue;
    if (!(item.step in result)) continue; // 모르는 step 번호는 무시
    if (/\d/.test(item.headline)) continue; // 숫자 섞이면 폴백(kicker) 유지
    result[item.step] = item.headline;
  }
  return result;
}
