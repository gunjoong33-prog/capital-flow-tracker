import type { ReactNode } from "react";
import type { StepDetailRow } from "@/lib/scoring/types";

export function StepCard({
  step,
  title,
  score,
  children,
  details,
  tip,
}: {
  step: number;
  title: string;
  score?: number;
  children: ReactNode;
  details?: StepDetailRow[];
  tip?: string;
}) {
  const tipId = `tip-${step}`;
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      {tip && <input type="checkbox" id={tipId} className="peer hidden" />}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-400">
            {step}단계 · {title}
          </h2>
          {tip && (
            <label
              htmlFor={tipId}
              className="flex h-4 w-4 cursor-pointer select-none items-center justify-center rounded-full border border-zinc-700 text-[10px] leading-none text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 peer-checked:border-zinc-400 peer-checked:text-zinc-200"
            >
              ?
            </label>
          )}
        </div>
        {score !== undefined && (
          <span className="text-xs text-zinc-500">점수 {score.toFixed(1)}</span>
        )}
      </div>
      {tip && (
        <div className="mb-3 hidden whitespace-pre-line rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs leading-relaxed text-zinc-400 peer-checked:block">
          {tip}
        </div>
      )}
      <div className="text-sm text-zinc-200">{children}</div>

      {details && details.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-xs text-zinc-500 hover:text-zinc-300">
            분석 기준·지표 상세 보기 ({details.length}개)
          </summary>
          <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/60 text-left text-zinc-500">
                  <th className="px-3 py-2 font-normal">지표</th>
                  <th className="px-3 py-2 font-normal">기준</th>
                  <th className="px-3 py-2 font-normal">실제값</th>
                  <th className="px-3 py-2 font-normal">충족</th>
                </tr>
              </thead>
              <tbody>
                {details.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-800/60 last:border-0">
                    <td className="px-3 py-2 text-zinc-300">{row.label}</td>
                    <td className="px-3 py-2 text-zinc-500">{row.criterion}</td>
                    <td className="px-3 py-2 text-zinc-200">{row.value}</td>
                    <td className="px-3 py-2">
                      {row.met === null ? (
                        <span className="text-zinc-600">-</span>
                      ) : row.met ? (
                        <span className="text-emerald-400">✓</span>
                      ) : (
                        <span className="text-rose-400">✕</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
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
