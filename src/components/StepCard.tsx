import type { ReactNode } from "react";
import type { StepDetailRow } from "@/lib/scoring/types";

function DetailTable({ rows }: { rows: StepDetailRow[] }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full table-fixed text-xs">
        <colgroup>
          <col className="w-[24%]" />
          <col className="w-[30%]" />
          <col className="w-[32%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-950/60 text-left text-zinc-500">
            <th className="px-3 py-2 font-normal">지표</th>
            <th className="px-3 py-2 font-normal">기준</th>
            <th className="px-3 py-2 font-normal">실제값</th>
            <th className="px-3 py-2 font-normal">충족</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            // run.ts가 "핵심값 — 부가설명" 형태로 값을 만드는 경우가 많다 — 나눠서
            // 핵심값은 굵게, 부가설명은 작은 보조 텍스트로 분리해야 표가 안 빽빽해진다.
            const [mainValue, ...noteParts] = row.value.split(" — ");
            const note = noteParts.join(" — ");
            return (
              <tr key={i} className="border-b border-zinc-800/60 align-top last:border-0">
                <td className="px-3 py-2.5 text-zinc-300">{row.label}</td>
                <td className="px-3 py-2.5 leading-relaxed text-zinc-500">{row.criterion}</td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-zinc-200">{mainValue}</div>
                  {note && <div className="mt-0.5 leading-snug text-zinc-500">{note}</div>}
                </td>
                <td className="px-3 py-2.5">
                  {row.met === null ? (
                    <span className="text-zinc-600">-</span>
                  ) : row.met ? (
                    <span className="text-emerald-400">✓</span>
                  ) : (
                    <span className="text-rose-400">✕</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface TipItem {
  text: string;
  marker: string;
  sub: string[];
}

/** 팁 텍스트 한 블록(빈 줄로 구분된 단위)을 제목 문단 + 불릿/번호 목록으로 구조화해서 렌더링. */
function TipBlock({ block }: { block: string }) {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

  // 불릿("-")·번호("1.")·보조설명("—")이 나오기 전까지의 앞머리 줄들은 제목 문단으로 합친다.
  let i = 0;
  const headingLines: string[] = [];
  while (i < lines.length && !/^[-—]|^\d+\.\s/.test(lines[i])) {
    headingLines.push(lines[i]);
    i++;
  }
  const heading = headingLines.length > 0 ? headingLines.join(" ") : null;

  const items: TipItem[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("—")) {
      if (items.length > 0) items[items.length - 1].sub.push(line.replace(/^—\s*/, ""));
      continue;
    }
    const numMatch = line.match(/^(\d+)\.\s+(.*)/);
    const bulletMatch = line.match(/^-\s+(.*)/);
    if (numMatch) {
      items.push({ text: numMatch[2], marker: `${numMatch[1]}.`, sub: [] });
    } else if (bulletMatch) {
      items.push({ text: bulletMatch[1], marker: "•", sub: [] });
    } else if (items.length > 0) {
      // 소스 코드에서 길어서 줄바꿈해둔 불릿의 이어지는 줄 — 새 항목이 아니라 이전 항목에 붙인다.
      items[items.length - 1].text += ` ${line}`;
    } else {
      items.push({ text: line, marker: "•", sub: [] });
    }
  }

  if (items.length === 0) {
    return <p className="leading-relaxed text-zinc-400">{heading}</p>;
  }

  return (
    <div>
      {heading && <p className="mb-1.5 leading-relaxed text-zinc-300">{heading}</p>}
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex gap-2 leading-relaxed">
            <span className="shrink-0 text-zinc-600">{item.marker}</span>
            <span className="text-zinc-400">
              {item.text}
              {item.sub.map((s, j) => (
                <span key={j} className="mt-0.5 block text-[11px] leading-snug text-zinc-600">
                  {s}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TipContent({ text }: { text: string }) {
  const blocks = text.split("\n\n").filter((b) => b.trim().length > 0);
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => (
        <TipBlock key={i} block={block} />
      ))}
    </div>
  );
}

export function StepCard({
  step,
  title,
  score,
  children,
  details,
  auxDetails,
  tip,
}: {
  step: number;
  title: string;
  score?: number;
  children: ReactNode;
  details?: StepDetailRow[];
  auxDetails?: StepDetailRow[];
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
        <div className="mb-3 hidden rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs peer-checked:block">
          <TipContent text={tip} />
        </div>
      )}
      <div className="text-sm text-zinc-200">{children}</div>

      {((details && details.length > 0) || (auxDetails && auxDetails.length > 0)) && (
        <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2">
          {details && details.length > 0 && (
            <details className="min-w-0 flex-1">
              <summary className="cursor-pointer select-none text-xs text-zinc-500 hover:text-zinc-300">
                분석 기준·지표 상세 보기 ({details.length}개)
              </summary>
              <DetailTable rows={details} />
            </details>
          )}
          {auxDetails && auxDetails.length > 0 && (
            <details className="min-w-0 flex-1">
              <summary className="cursor-pointer select-none text-xs text-zinc-500 hover:text-zinc-300">
                보조 지표 보기 ({auxDetails.length}개, 집계 제외)
              </summary>
              <DetailTable rows={auxDetails} />
            </details>
          )}
        </div>
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
