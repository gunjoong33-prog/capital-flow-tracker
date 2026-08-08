// 홈 화면 PPT 슬라이드 카드(9장)의 숫자·사실을 결정론적으로 조립한다. pure.ts와 같은 계층 —
// DB·LLM 호출 없이 이미 계산된 step1~8 결과만으로 순수하게 만든다. headline(훅 헤드라인)만
// 이 파일 밖(ppt-headlines.ts)에서 LLM으로 채워진다 — 숫자를 다루는 이 파일은 LLM과 완전히
// 분리해서, 숫자를 잘못 옮겨 적는 부류의 버그가 애초에 발생할 수 없게 한다.
import { WEIGHTS } from "./pure";
import type {
  PptSlide, SectorInput,
  Step1Result, Step2Result, Step3Result, Step4Result, Step5Result, Step6Result, Step7Result, Step8Result,
} from "./types";

export interface BuildPptSlidesInput {
  step1: Step1Result; step2: Step2Result; step3: Step3Result; step4: Step4Result;
  step5: Step5Result; step6: Step6Result; step7: Step7Result; step8: Step8Result;
  step2Summary: string; step3Summary: string; step4Summary: string;
  step5Summary: string; step6Summary: string; step7Summary: string;
  vix: number | null;
  fearGreed: number | null;
  sectors: SectorInput[];
  bigTechMovers: { ticker: string; label: string; changePct: number | null; reason: string }[];
}

/** 여러 줄 요약 문자열(stepNSummary)의 첫 문장만 슬라이드 본문으로 쓴다 — 새 문장을 짓지 않는다. */
function firstLine(summary: string): string {
  return summary.split("\n")[0] ?? summary;
}

function pctLabel(pct: number | null): string {
  if (pct === null) return "확인 못함";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

export function buildPptSlides(input: BuildPptSlidesInput): PptSlide[] {
  const { step1, step2, step3, step4, step5, step6, step7, step8 } = input;

  const slide1: PptSlide = {
    step: 1,
    kicker: "사실 · 오늘의 결론",
    headline: "사실 · 오늘의 결론",
    body: step1.vetoTriggered ? step1.reason : "거부권 발동 없음",
    visual: {
      type: "stat-pair",
      left: { value: step8.macroTrendScore.toFixed(2), label: "투자 적합도", tone: "accent" },
      right: step1.vetoTriggered
        ? { value: "거부권", label: "1단계 발동", tone: "neg" }
        : { value: "통과", label: "1단계 거부권", tone: "pos" },
    },
  };

  const slide2: PptSlide = {
    step: 2,
    kicker: "사실 · 유동성",
    headline: "사실 · 유동성",
    body: firstLine(input.step2Summary),
    visual: { type: "ratio-bar", qualifying: step2.overseasQualifyingCount, total: step2.overseasTotalCount, label: "유동성 우호 지표" },
  };

  const carrySafeMarginBp = 350;
  const slide3: PptSlide = {
    step: 3,
    kicker: "사실 · 캐리 트레이드",
    headline: "사실 · 캐리 트레이드",
    body: firstLine(input.step3Summary),
    visual: {
      type: "bar-pair",
      left: { value: `${step3.spreadBp}bp`, label: "현재 스프레드", heightPct: Math.round(Math.min(100, (step3.spreadBp / carrySafeMarginBp) * 100)) },
      right: { value: `${carrySafeMarginBp}bp`, label: "안전 마진", heightPct: 100 },
    },
  };

  const slide4: PptSlide = {
    step: 4,
    kicker: "사실 · 환율·금·유가",
    headline: "사실 · 환율·금·유가",
    body: firstLine(input.step4Summary),
    visual: {
      type: "stat-pair",
      left: { value: step4.quadrant, label: "사분면" },
      right: { value: `${step4.score}/10`, label: "점수", tone: step4.score >= 5 ? "pos" : "neg" },
    },
  };

  const validMovers = input.bigTechMovers.filter((m) => m.changePct !== null);
  const bestMover = validMovers.length > 0 ? validMovers.reduce((a, b) => (b.changePct! > a.changePct! ? b : a)) : null;
  const worstMover = validMovers.length > 0 ? validMovers.reduce((a, b) => (b.changePct! < a.changePct! ? b : a)) : null;
  const slide5: PptSlide = {
    step: 5,
    kicker: "사실 · 자금 도착",
    headline: "사실 · 자금 도착",
    body: firstLine(input.step5Summary),
    visual:
      bestMover && worstMover
        ? {
            type: "stat-pair",
            left: { value: pctLabel(bestMover.changePct), label: bestMover.label, tone: "pos" },
            right: { value: pctLabel(worstMover.changePct), label: worstMover.label, tone: "neg" },
          }
        : { type: "none" },
  };

  const sortedSectors = [...input.sectors].sort((a, b) => b.return5d - a.return5d);
  const topSector = sortedSectors[0] ?? null;
  const slide6: PptSlide = {
    step: 6,
    kicker: "사실 · 섹터",
    headline: "사실 · 섹터",
    body: firstLine(input.step6Summary),
    visual: topSector
      ? {
          type: "stat-pair",
          left: { value: `${topSector.return5d.toFixed(2)}%`, label: `${topSector.name} (5일 1위)`, tone: "accent" },
          right: { value: `${step6.qualifying.length}개`, label: "충족 섹터" },
        }
      : { type: "none" },
  };

  const slide7: PptSlide = {
    step: 7,
    kicker: "사실 · 심리 필터",
    headline: "사실 · 심리 필터",
    body: firstLine(input.step7Summary),
    visual: {
      type: "stat-pair",
      left: { value: input.vix !== null ? input.vix.toFixed(2) : "확인 못함", label: "VIX" },
      right: { value: input.fearGreed !== null ? input.fearGreed.toFixed(1) : "확인 못함", label: "공포탐욕지수" },
    },
  };

  const slide8: PptSlide = {
    step: 8,
    kicker: "사실 · 최종 결론 계산",
    headline: "사실 · 최종 결론 계산",
    body: step8.vetoApplied ? "거부권 발동으로 한 단계 하향 조정되었습니다." : "거부권은 발동되지 않았습니다.",
    visual: {
      type: "weight-bars",
      rows: [
        { label: "유동성", score: step2.finalScore, weight: WEIGHTS.step2 },
        { label: "캐리 트레이드", score: step3.score, weight: WEIGHTS.step3 },
        { label: "환율·금·유가", score: step4.score, weight: WEIGHTS.step4 },
        { label: "자금 도착", score: step5.score, weight: WEIGHTS.step5 },
        { label: "섹터", score: step6.score, weight: WEIGHTS.step6 },
      ],
    },
  };

  const slide9: PptSlide = {
    step: 9,
    kicker: "결론",
    headline: "결론",
    body: "",
    visual: {
      type: "stat-pair",
      left: { value: step8.macroTrendScore.toFixed(2), label: "투자 적합도", tone: "accent" },
      right: { value: step8.finalDecision, label: "최종 결론" },
    },
  };

  return [slide1, slide2, slide3, slide4, slide5, slide6, slide7, slide8, slide9];
}
