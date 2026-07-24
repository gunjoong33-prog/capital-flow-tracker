import type { ReactNode } from "react";

export function StepCard({
  step,
  title,
  score,
  children,
}: {
  step: number;
  title: string;
  score?: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-400">
          {step}단계 · {title}
        </h2>
        {score !== undefined && (
          <span className="text-xs text-zinc-500">점수 {score.toFixed(1)}</span>
        )}
      </div>
      <div className="text-sm text-zinc-200">{children}</div>
    </section>
  );
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-zinc-800/60 py-1.5 last:border-0">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium text-zinc-100">{value}</span>
    </div>
  );
}
