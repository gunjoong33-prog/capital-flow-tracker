// 점수는 색 배지로 만들지 않는다 — 옆의 DecisionBadge가 이미 같은 신호를 색으로 보여주는데
// 점수까지 같은 색 배지로 중복 표시하면 배지 두 개가 붙어 하나의 얼룩처럼 보인다(사이트
// 디자인과 안 어울린다는 지적, 실제 확인). /reports/[type] 아카이브 페이지도 점수는 배지가
// 아니라 옅은 텍스트(.item__score)로만 보여주는 걸 따른다. 소수점 둘째 자리까지 — 8단계
// 상세표(run.ts의 macroTrendScore.toFixed(2))와 자릿수를 맞춘다.
export function ScoreBadge({ score, label }: { score: number; label?: string }) {
  return (
    <span className="text-sm text-[var(--ink-dim)]">
      {label ? `${label} ` : ""}
      {score.toFixed(2)}
    </span>
  );
}

// StepGraphs.tsx의 GRAPH_COLOR_AMBER(#e0a63e)와 같은 값으로 맞춰, 같은 화면 안 그래프의
// amber 색과 "지켜보기" 배지 색이 어긋나지 않게 한다.
const WATCH_COLOR = "#e0a63e";

// 이 사이트의 다른 모든 컴포넌트(RiskyNewsList, StepGraphs, /reports 아카이브)는 Tailwind
// 기본 팔레트(emerald/amber/rose-400 등)가 아니라 site.module.css의 --pos/--neg 같은 자체
// 디자인 토큰을 쓴다 — 이 배지만 기본 팔레트를 그대로 써서 튀어 보였다(사이트 디자인과 안
// 어울린다는 지적, 실제 확인). color-mix는 StepGraphs.tsx에서 이미 쓰는 방식과 동일.
export function DecisionBadge({ decision }: { decision: "매수" | "지켜보기" | "현금비중늘리기" }) {
  const color = decision === "매수" ? "var(--pos)" : decision === "지켜보기" ? WATCH_COLOR : "var(--neg)";

  return (
    <span
      className="inline-flex items-center rounded-full border px-4 py-1.5 text-lg font-semibold"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
      }}
    >
      {decision}
    </span>
  );
}
