// CNN 공포와 탐욕 지수(Fear & Greed Index) 반원 게이지 — 서드파티 임베드 없이 직접 그린다.
// 값은 서버(page.tsx)에서 DB(MetricValue, metric=CNN_FEAR_GREED)로 조회해 넘겨받는다.
// 구간 경계(24/44/55/75)는 CNN 공식 기준이자 src/lib/scoring/run.ts의 cnnFearGreedRating과 동일하다.
const BANDS = [
  { min: 0, max: 24, color: "#f43f5e", label: "극단적 공포" },
  { min: 24, max: 44, color: "#fb923c", label: "공포" },
  { min: 44, max: 55, color: "#eab308", label: "중립" },
  { min: 55, max: 75, color: "#84cc16", label: "탐욕" },
  { min: 75, max: 100, color: "#22c55e", label: "극단적 탐욕" },
] as const;

function ratingOf(value: number) {
  return BANDS.find((b) => value <= b.max) ?? BANDS[BANDS.length - 1];
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

/** value 0~100 -> 각도 180°(왼쪽,극단적공포) ~ 0°(오른쪽,극단적탐욕), 중립(50)이 정상단(90°). */
function angleOf(value: number) {
  return 180 - (value / 100) * 180;
}

function bandArcPath(cx: number, cy: number, r: number, min: number, max: number) {
  const p1 = polar(cx, cy, r, angleOf(min));
  const p2 = polar(cx, cy, r, angleOf(max));
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 0 1 ${p2.x} ${p2.y}`;
}

export function CnnFearGreedGauge({ value }: { value: number | null }) {
  const cx = 150;
  const cy = 138;
  const r = 100;
  const rating = value !== null ? ratingOf(value) : null;
  const needleTip = polar(cx, cy, r - 18, angleOf(value ?? 50));

  return (
    <svg viewBox="-20 0 340 205" className="h-full w-full">
      {BANDS.map((b) => (
        <path
          key={b.label}
          d={bandArcPath(cx, cy, r, b.min, b.max)}
          fill="none"
          stroke={b.color}
          strokeWidth={15}
          opacity={value === null ? 0.35 : 1}
        />
      ))}
      {BANDS.map((b) => {
        const mid = (b.min + b.max) / 2;
        const p = polar(cx, cy, r + 18, angleOf(mid));
        const anchor = b.min === 0 ? "end" : b.max === 100 ? "start" : "middle";
        return (
          <text
            key={`label-${b.label}`}
            x={p.x}
            y={p.y}
            textAnchor={anchor}
            fill="var(--ink-faint, #71717a)"
            style={{ fontSize: 10.5 }}
          >
            {b.label}
          </text>
        );
      })}
      {value !== null && (
        <>
          <line x1={cx} y1={cy} x2={needleTip.x} y2={needleTip.y} stroke="var(--ink, white)" strokeWidth={3} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={6} fill="var(--ink, white)" />
        </>
      )}
      <text x={cx} y={cy + 42} textAnchor="middle" fill="var(--ink, #f4f4f5)" style={{ fontSize: 32, fontWeight: 600 }}>
        {value !== null ? value.toFixed(0) : "-"}
      </text>
      <text x={cx} y={cy + 65} textAnchor="middle" fill={rating ? rating.color : "#71717a"} style={{ fontSize: 15, fontWeight: 500 }}>
        {rating ? rating.label : "확인 못함"}
      </text>
    </svg>
  );
}
