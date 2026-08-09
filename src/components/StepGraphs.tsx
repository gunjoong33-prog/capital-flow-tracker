// 오늘의 리포트 단계 탭 UI — 직관적 이해를 돕기 위해 필요한 단계에만 붙이는 그래프들.
// 전부 실제 표시값(details 표)에서 이미 검증된 숫자만 가져다 쓴다 — 새로운 계산을 하지 않는다
// (숫자 자체는 run.ts가 만든 걸 그대로 재사용, 여기선 시각화만).

// site.module.css의 --pos/--neg/--accent 팔레트엔 보라·호박색이 없다(중간 경고 톤·8단계
// 기여도 5개 구간을 다 구분하려면 색이 더 필요함) — 여기 한 곳에서만 상수로 관리하고
// ReportView.tsx가 가져다 쓴다(예전엔 두 파일에 같은 16진수를 각자 따로 박아뒀었다).
export const GRAPH_COLOR_PURPLE = "#8b7fd6";
export const GRAPH_COLOR_AMBER = "#e0a63e";

function GraphBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-[var(--ink-faint)]">{label}</p>
      {children}
    </div>
  );
}

/** 2단계 — 해외 지표 충족 비율 도넛. */
export function Step2Donut({ qualifying, total }: { qualifying: number; total: number }) {
  if (total === 0) return null;
  const pct = qualifying / total;
  const circumference = 2 * Math.PI * 15.9;
  const dash = circumference * pct;
  return (
    <GraphBox label="충족 비율">
      <div className="flex flex-wrap items-center gap-6">
        <svg width="96" height="96" viewBox="0 0 42 42" className="shrink-0">
          <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="var(--border)" strokeWidth="5" />
          <circle
            cx="21" cy="21" r="15.9" fill="transparent" stroke={pct >= 0.5 ? "var(--pos)" : "var(--neg)"} strokeWidth="5"
            strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={circumference * 0.25} strokeLinecap="round"
          />
        </svg>
        <div>
          <div className="text-2xl font-bold text-[var(--ink)]">
            {qualifying}<span className="text-sm font-normal text-[var(--ink-faint)]">/{total} 충족</span>
          </div>
        </div>
      </div>
    </GraphBox>
  );
}

/** 3단계 — 안전 임계값(350bp) 대비 스프레드 바. */
export function Step3ThresholdBar({ spreadBp, thresholdBp = 350 }: { spreadBp: number; thresholdBp?: number }) {
  const pct = Math.min(100, Math.max(0, (spreadBp / thresholdBp) * 100));
  const safe = spreadBp < thresholdBp;
  return (
    <GraphBox label={`안전 임계값(${thresholdBp}bp) 대비`}>
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-xs text-[var(--ink-faint)]">현재 {spreadBp}bp</span>
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: safe ? "var(--pos)" : "var(--neg)" }} />
        </div>
        <span className="w-12 shrink-0 text-right text-xs text-[var(--ink-dim)]">{pct.toFixed(0)}%</span>
      </div>
      <p className="mt-2 text-[11px] text-[var(--ink-faint)]">
        {safe ? `${thresholdBp}bp 도달 시 청산 위험 구간 진입 — 현재 ${thresholdBp - spreadBp}bp 여유` : `안전 임계값을 이미 초과함`}
      </p>
    </GraphBox>
  );
}

/** 4단계 — 금·실질금리 방향 사분면 위치. */
export function Step4Quadrant({ quadrant }: { quadrant: string }) {
  const goldUp = quadrant.includes("금↑");
  const realRateUp = quadrant.includes("실질금리↑");
  const left = goldUp ? "28%" : "72%";
  const top = realRateUp ? "28%" : "72%";
  return (
    <GraphBox label="사분면 위치">
      {/* 왼쪽=금↑ 오른쪽=금↓, 위=실질금리↑ 아래=실질금리↓ — 4개 라벨이 이 두 축으로 일관되게 배치돼야
          점 위치와 라벨이 실제로 맞는다(처음엔 라벨 4개를 각자 눈대중으로 적어서 좌우/상하 축이
          안 맞았음 — 실사용 데이터로 확인 중 발견). */}
      <div className="relative h-44 w-44 rounded-lg border border-[var(--border)]">
        <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--border)]" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--border)]" />
        <span className="absolute left-1.5 top-1 text-[10px] text-[var(--ink-faint)]">금↑ 실질금리↑</span>
        <span className="absolute right-1.5 top-1 text-right text-[10px] text-[var(--ink-faint)]">금↓/보합 실질금리↑</span>
        <span className="absolute bottom-1 left-1.5 text-[10px] text-[var(--ink-faint)]">금↑ 실질금리↓/보합</span>
        <span className="absolute bottom-1 right-1.5 text-right text-[10px] text-[var(--ink-faint)]">금↓/보합 실질금리↓/보합</span>
        <div
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)]"
          style={{ left, top, boxShadow: "0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent)" }}
        />
      </div>
    </GraphBox>
  );
}

/** 6단계 — 섹터별 5일 수익률 바 차트. */
export function Step6SectorBars({ sectors }: { sectors: { name: string; return5d: number }[] }) {
  if (sectors.length === 0) return null;
  const maxAbs = Math.max(...sectors.map((s) => Math.abs(s.return5d)), 1);
  return (
    <GraphBox label="섹터별 5일 수익률">
      <div className="space-y-2">
        {sectors.map((s) => {
          const widthPct = Math.min(100, (Math.abs(s.return5d) / maxAbs) * 100);
          return (
            <div key={s.name} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-xs text-[var(--ink-faint)]">{s.name}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${widthPct}%`, background: s.return5d >= 0 ? "var(--accent)" : "var(--neg)" }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-xs text-[var(--ink-dim)]">{s.return5d >= 0 ? "+" : ""}{s.return5d.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </GraphBox>
  );
}

/** 7단계 — VIX·공포탐욕지수 게이지. */
export function Step7Gauge({ vix, fearGreed }: { vix: number | null; fearGreed: number | null }) {
  if (vix === null && fearGreed === null) return null;
  const fgPct = fearGreed !== null ? Math.min(100, Math.max(0, fearGreed)) : 50;
  const circumference = 188.5; // 반원 둘레(r=60) 근사
  const dash = (fgPct / 100) * circumference;
  const zoneColor = fearGreed === null ? "var(--ink-faint)" : fearGreed < 25 || fearGreed > 75 ? "var(--neg)" : fearGreed < 45 || fearGreed > 55 ? GRAPH_COLOR_AMBER : "var(--pos)";
  return (
    <GraphBox label="VIX · 공포탐욕지수">
      <div className="flex flex-wrap items-center gap-6">
        <svg width="140" height="80" viewBox="0 0 140 80" className="shrink-0">
          <path d="M10,75 A60,60 0 0 1 130,75" fill="none" stroke="var(--border)" strokeWidth="10" strokeLinecap="round" />
          <path
            d="M10,75 A60,60 0 0 1 130,75" fill="none" stroke={zoneColor} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
          />
        </svg>
        <div className="space-y-1.5 text-sm text-[var(--ink-dim)]">
          {vix !== null && <div>VIX <b className="text-[var(--ink)]">{vix.toFixed(1)}</b></div>}
          {fearGreed !== null && <div>공포탐욕지수 <b className="text-[var(--ink)]">{fearGreed.toFixed(1)}</b></div>}
        </div>
      </div>
    </GraphBox>
  );
}

/** 8단계 — 2~6단계 가중 기여도 스택바. */
export function Step8ContributionBar({
  contributions,
}: {
  contributions: { label: string; weighted: number; color: string }[];
}) {
  const total = contributions.reduce((sum, c) => sum + Math.max(0, c.weighted), 0);
  if (total === 0) return null;
  return (
    <GraphBox label="단계별 기여도(가중 반영)">
      <div className="flex h-6 overflow-hidden rounded-lg">
        {contributions.map((c) => (
          <div key={c.label} style={{ width: `${(Math.max(0, c.weighted) / total) * 100}%`, background: c.color }} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[var(--ink-faint)]">
        {contributions.map((c) => (
          <span key={c.label}>
            <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
    </GraphBox>
  );
}
