// 적중률(트랙레코드) 페이지 전용 그래프 — 표만으로는 한눈에 안 들어오는 "적중률 자체"와
// "시간에 따른 적중 흐름"을 시각화한다. 기존 오늘의 리포트 그래프(StepGraphs.tsx)의 GraphBox를
// 그대로 재사용해 사이트 전체 시각 언어를 맞춘다.
//
// 색 선택: 이 페이지는 이미 "등락 색(빨강=상승/파랑=하락)과 적중 배지 색을 분리"하기로 확정했다
// (HitCell 주석 참고) — 그 결정을 깨지 않도록 적중/미적중에도 --pos/--neg(가격 등락 색)를 쓰지
// 않고 --accent(적중)·--ink-faint(미적중)·--border(채점 대기)로만 구분한다.
import type { VerdictOutcome } from "@/lib/verdict-outcomes";
import { GraphBox } from "@/components/StepGraphs";

/** 적중률 하나를 원형 게이지로 — 표 위 요약 카드 옆에 붙여 숫자를 한눈에 보완한다. */
export function HitRateDonut({ pct }: { pct: number }) {
  const circumference = 2 * Math.PI * 15.9;
  const dash = circumference * (pct / 100);
  return (
    <svg width="52" height="52" viewBox="0 0 42 42" className="shrink-0" aria-hidden="true">
      <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="var(--border)" strokeWidth="5" />
      <circle
        cx="21" cy="21" r="15.9" fill="transparent" stroke="var(--accent)" strokeWidth="5"
        strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={circumference * 0.25} strokeLinecap="round"
      />
      <text x="21" y="24.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--ink)">
        {pct}%
      </text>
    </svg>
  );
}

function cellColor(hit: boolean | null): string {
  if (hit === null) return "var(--border)";
  return hit ? "var(--accent)" : "var(--ink-faint)";
}

function TrendRow({
  label,
  outcomes,
  hitKey,
  returnKey,
  anchorKey,
}: {
  label: string;
  outcomes: VerdictOutcome[];
  hitKey: "hitSp500" | "hitKospi";
  returnKey: "sp500ReturnPct" | "kospiReturnPct";
  anchorKey: "sp500AnchorDate" | "kospiAnchorDate";
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs text-[var(--ink-faint)]">{label}</span>
      <div className="flex flex-wrap gap-1">
        {outcomes.map((o) => {
          const hit = o[hitKey];
          const ret = o[returnKey];
          const dateLabel = o.marketDate ?? o.date;
          const status = hit === null ? "채점 대기" : hit ? "적중" : "미적중";
          const retLabel = ret !== null ? ` (${ret >= 0 ? "+" : ""}${ret}%)` : "";
          return (
            <span
              key={o.date}
              title={`${dateLabel} · ${status}${retLabel}`}
              className="h-3 w-3 rounded-sm"
              style={{ background: cellColor(hit) }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** 표 하나로는 안 보이던 "최근 들어 미적중이 몰렸는지" 같은 흐름을 색 띠로 보여준다.
 *  outcomes는 최신순(desc)으로 들어오므로 여기서 시간순(과거→최신)으로 뒤집어 왼쪽→오른쪽으로 읽는다. */
export function HitTrendStrip({ outcomes }: { outcomes: VerdictOutcome[] }) {
  if (outcomes.length === 0) return null;
  const chronological = [...outcomes].reverse();

  return (
    <GraphBox label="적중 추이(과거 → 최신)">
      <div className="space-y-2.5">
        <TrendRow label="S&P500" outcomes={chronological} hitKey="hitSp500" returnKey="sp500ReturnPct" anchorKey="sp500AnchorDate" />
        <TrendRow label="코스피" outcomes={chronological} hitKey="hitKospi" returnKey="kospiReturnPct" anchorKey="kospiAnchorDate" />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--ink-faint)]">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: "var(--accent)" }} />
          적중
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: "var(--ink-faint)" }} />
          미적중
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: "var(--border)" }} />
          채점 대기
        </span>
      </div>
    </GraphBox>
  );
}
