// 점수 하나를 색깔 배지로 보여준다. 0~10 스케일 기준(v2 프롬프트 8단계 채점 방식과 동일).
// 소수점 둘째 자리까지 — 8단계 상세표(run.ts의 macroTrendScore.toFixed(2))와 페이지 안에서
// 같은 숫자가 서로 다른 자릿수로 두 번 보이던 불일치를 없앤다(예: 최상단 배지 "3.0" vs
// 상세표 "2.95", 코드 감사로 발견).
export function ScoreBadge({ score, label }: { score: number; label?: string }) {
  const color =
    score >= 7 ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
    score >= 5 ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
    "bg-rose-500/15 text-rose-400 border-rose-500/30";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium ${color}`}>
      {label ? `${label} ` : ""}
      {score.toFixed(2)}
    </span>
  );
}

export function DecisionBadge({ decision }: { decision: "매수" | "지켜보기" | "현금비중늘리기" }) {
  const styles = {
    매수: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    지켜보기: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    현금비중늘리기: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  } as const;

  return (
    <span className={`inline-flex items-center rounded-full border px-4 py-1.5 text-lg font-semibold ${styles[decision]}`}>
      {decision}
    </span>
  );
}
