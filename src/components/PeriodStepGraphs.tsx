// 주기별 리포트(주/월/분기/연간) 1~8단계 탭 전용 그래프 — StepGraphs.tsx(오늘의 리포트, 하루치
// 단일 값)와 짝을 이루는 "기간 내 추이" 버전이다. 전부 서버에서 좌표를 미리 계산해 순수 SVG로
// 그린다(클라이언트 컴포넌트 아님 — 이 사이트 전체가 지키는 원칙, ReportView 메모리 참고).
import { GraphBox } from "@/components/StepGraphs";

const CHART_W = 220;
const CHART_H = 48;
const PAD_Y = 5;

function pathPoints(values: number[], domainMin?: number, domainMax?: number): string {
  if (values.length === 0) return "";
  const min = domainMin ?? Math.min(...values);
  const max = domainMax ?? Math.max(...values);
  const span = max - min || 1;
  if (values.length === 1) {
    const y = CHART_H - PAD_Y - ((values[0] - min) / span) * (CHART_H - PAD_Y * 2);
    return `${CHART_W / 2},${y.toFixed(1)}`;
  }
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * CHART_W;
      const y = CHART_H - PAD_Y - ((v - min) / span) * (CHART_H - PAD_Y * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** 지표 하나의 기간 내 일별 추이 — 라인 하나 + 시작·끝 변화폭 배지. 지표마다 단위·스케일이
 * 달라(WALCL은 조 단위, 실질금리는 %) 한 그래프에 여러 지표를 같이 그리지 않고 지표별로
 * 작은 그래프를 나열한다. deltaLabel·deltaPositive는 페이지가 이미 계산해둔
 * summary.metricChangesPct/metricPointChangesBp(단일 값)를 그대로 받는다 — 같은 숫자를
 * 두 곳에서 서로 다르게 재계산하지 않기 위함. */
export function MetricSparkline({
  label,
  series,
  deltaLabel,
  deltaPositive,
}: {
  label: string;
  series: { date: string; value: number }[];
  deltaLabel: string | null;
  deltaPositive: boolean | null;
}) {
  if (series.length === 0) {
    return (
      <div className="flex items-center justify-between border-b border-[var(--border)] py-2.5 text-sm last:border-b-0">
        <span className="text-[var(--ink-dim)]">{label}</span>
        <span className="text-xs text-[var(--ink-faint)]">확인 못함</span>
      </div>
    );
  }
  const values = series.map((p) => p.value);
  const points = pathPoints(values);
  const lineColor = deltaPositive === null ? "var(--ink-faint)" : deltaPositive ? "var(--pos)" : "var(--neg)";
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-2.5 text-sm last:border-b-0">
      <span className="w-32 shrink-0 text-[var(--ink-dim)]">{label}</span>
      <svg width={CHART_W / 2} height={CHART_H / 2} viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="shrink-0" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke={lineColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span
        className="w-16 shrink-0 text-right text-xs"
        style={{ color: deltaLabel === null ? "var(--ink-faint)" : deltaPositive ? "var(--pos)" : "var(--neg)" }}
      >
        {deltaLabel ?? "확인 못함"}
      </span>
    </div>
  );
}

/** 단계 점수(0~10 고정 스케일)의 기간 내 일별 추이 — 스케일을 고정해야 여러 단계 그래프를
 * 나란히 봤을 때 기울기가 실제 점수 변화와 비례해서 비교 가능하다(지표별 min/max로 자동
 * 스케일하면 작은 변동도 크게 보여 단계 간 비교가 왜곡된다). */
export function ScoreTrend({ label, series }: { label: string; series: (number | null)[] }) {
  const values = series.filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const first = values[0];
  const last = values[values.length - 1];
  const positive = last >= first;
  const points = pathPoints(values, 0, 10);
  const midY = CHART_H - PAD_Y - (5 / 10) * (CHART_H - PAD_Y * 2);
  return (
    <GraphBox label={`${label} 점수 추이(0~10)`}>
      <div className="flex items-center gap-4">
        <svg width={CHART_W} height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="shrink-0" preserveAspectRatio="none">
          <line x1="0" y1={midY} x2={CHART_W} y2={midY} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
          <polyline
            points={points} fill="none" stroke={positive ? "var(--pos)" : "var(--neg)"}
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
        <div className="shrink-0 text-xs text-[var(--ink-dim)]">
          <div>시작 <b className="text-[var(--ink)]">{first.toFixed(2)}</b></div>
          <div>끝 <b className="text-[var(--ink)]">{last.toFixed(2)}</b></div>
        </div>
      </div>
    </GraphBox>
  );
}

/** 비율 하나를 막대로 — 거부권 발동 비율처럼 "높을수록 나쁜" 지표는 dangerWhenHigh로 색을
 * 뒤집는다(Step2Donut은 항상 높을수록 좋은 "충족 비율"이라 이 케이스에 그대로 못 쓴다). */
export function RatioBar({
  label, count, total, unit = "일", dangerWhenHigh = false,
}: { label: string; count: number; total: number; unit?: string; dangerWhenHigh?: boolean }) {
  if (total === 0) return null;
  const pct = (count / total) * 100;
  const good = dangerWhenHigh ? pct < 50 : pct >= 50;
  return (
    <GraphBox label={label}>
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-xs text-[var(--ink-faint)]">
          {count}/{total}{unit}
        </span>
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: good ? "var(--pos)" : "var(--neg)" }} />
        </div>
        <span className="w-12 shrink-0 text-right text-xs text-[var(--ink-dim)]">{pct.toFixed(0)}%</span>
      </div>
    </GraphBox>
  );
}

/** Record<라벨, 등장횟수> 하나를 가로 막대로 — 6단계 topSectors(충족 섹터 빈도), 4단계
 * quadrantCounts(사분면 분포) 둘 다 이 모양이라 공용으로 쓴다. */
export function FrequencyBars({ label, counts, unit = "일" }: { label: string; counts: Record<string, number>; unit?: string }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map(([, n]) => n));
  return (
    <GraphBox label={label}>
      <div className="space-y-2">
        {entries.map(([name, n]) => (
          <div key={name} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-xs text-[var(--ink-faint)]">{name}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
              <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(n / max) * 100}%` }} />
            </div>
            <span className="w-12 shrink-0 text-right text-xs text-[var(--ink-dim)]">{n}{unit}</span>
          </div>
        ))}
      </div>
    </GraphBox>
  );
}
