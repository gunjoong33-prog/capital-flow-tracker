import type { ReactNode } from "react";
import type { StepDetailRow } from "@/lib/scoring/types";

/** "Fed 대차대조표(WALCL)" -> 본명 + 코드로 나눈다 — 괄호가 좁은 열 안에서 줄바꿈되며 읽기 불편해지는 걸 막는다. */
function splitLabel(label: string): { main: string; code: string | null } {
  const match = label.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  return match ? { main: match[1], code: match[2] } : { main: label, code: null };
}

/**
 * hideMetColumn=true면 마지막 열 자체를 없앤다(순수 실제값 나열용, 예: 5단계 마감가 원자료).
 * row.result가 있으면 마지막 열 헤더를 "결과"로 바꾸고 ✓/✕ 아이콘 대신 텍스트를 보여준다
 * (충족/불충족으로 나누기 애매한 범주형 판정용, 예: 5단계 위험선호/쏠림 여부).
 * wideCriterion=true면 지표열을 줄이고 기준열을 늘린다(기준 문장이 긴 표의 가독성용, 예: 6단계).
 */
function DetailTable({
  rows,
  hideMetColumn = false,
  wideCriterion = false,
}: {
  rows: StepDetailRow[];
  hideMetColumn?: boolean;
  wideCriterion?: boolean;
}) {
  const resultMode = rows.some((r) => r.result !== undefined);
  const metHeader = resultMode ? "결과" : "충족";
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full table-fixed text-xs">
        <colgroup>
          <col className={wideCriterion ? "w-[18%]" : "w-[26%]"} />
          <col className={hideMetColumn ? "w-[36%]" : resultMode ? "w-[18%]" : wideCriterion ? "w-[40%]" : "w-[32%]"} />
          <col className={hideMetColumn ? "w-[38%]" : resultMode ? "w-[36%]" : "w-[34%]"} />
          {!hideMetColumn && <col className={resultMode ? "w-[20%]" : "w-[8%]"} />}
        </colgroup>
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-950/60 text-left text-zinc-500">
            <th className="px-3 py-2 font-normal">지표</th>
            <th className="px-3 py-2 font-normal">기준</th>
            <th className="px-3 py-2 font-normal">실제값</th>
            {!hideMetColumn && <th className="px-3 py-2 font-normal">{metHeader}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            // run.ts가 "핵심값 — 부가설명 — 부가설명2" 형태로 값을 만드는 경우가 많다 — 나눠서
            // 핵심값은 굵게, 부가설명은 각각 줄을 나눠 작은 보조 텍스트로 분리해야 표가 안 빽빽해진다
            // (예: 5단계 빅테크는 마감가 / 전일 대비 변동 / 등락 원인 3줄로 나뉜다).
            const [mainValue, ...noteParts] = row.value.split(" — ");
            const { main: labelMain, code: labelCode } = splitLabel(row.label);
            return (
              <tr key={i} className="border-b border-zinc-800/60 align-top last:border-0">
                <td className="px-3 py-2.5">
                  <div className="text-zinc-300">{labelMain}</div>
                  {labelCode && <div className="mt-0.5 text-[10px] text-zinc-600">{labelCode}</div>}
                </td>
                <td className="px-3 py-2.5 leading-relaxed text-zinc-500">{row.criterion}</td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-zinc-200">{mainValue}</div>
                  {noteParts.map((part, j) => (
                    <div key={j} className="mt-0.5 leading-snug text-zinc-500">{part}</div>
                  ))}
                </td>
                {!hideMetColumn && (
                  <td className="px-3 py-2.5">
                    {row.result !== undefined ? (
                      <span className="text-zinc-300">{row.result}</span>
                    ) : row.met === null ? (
                      <span className="text-zinc-600">-</span>
                    ) : row.met ? (
                      <span className="text-emerald-400">✓</span>
                    ) : (
                      <span className="text-rose-400">✕</span>
                    )}
                  </td>
                )}
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
  auxHideMetColumn,
  auxLabel = "보조 지표",
  aux2Details,
  aux2HideMetColumn,
  aux2Label = "보조 지표",
  detailsWideCriterion,
  tip,
  summary,
}: {
  step: number;
  title: string;
  score?: number;
  children: ReactNode;
  details?: StepDetailRow[];
  auxDetails?: StepDetailRow[];
  auxHideMetColumn?: boolean;
  auxLabel?: string;
  aux2Details?: StepDetailRow[]; // 보조 표를 2개 두고 싶을 때(예: 5단계 지수·크립토 아래에 빅테크 7 별도 표)
  aux2HideMetColumn?: boolean;
  aux2Label?: string;
  detailsWideCriterion?: boolean;
  tip?: string;
  summary?: string;
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

      {summary && (
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">종합판단</p>
          <p className="whitespace-pre-line text-xs leading-relaxed text-zinc-300">{summary}</p>
        </div>
      )}

      {((details && details.length > 0) || (auxDetails && auxDetails.length > 0) || (aux2Details && aux2Details.length > 0)) && (
        <div className="mt-3 space-y-2">
          {details && details.length > 0 && (
            <details>
              <summary className="cursor-pointer select-none text-xs text-zinc-500 hover:text-zinc-300">
                분석 기준·지표 상세 보기 ({details.length}개)
              </summary>
              <DetailTable rows={details} wideCriterion={detailsWideCriterion} />
            </details>
          )}
          {auxDetails && auxDetails.length > 0 && (
            <details>
              <summary className="cursor-pointer select-none text-xs text-zinc-500 hover:text-zinc-300">
                {auxLabel} 보기 ({auxDetails.length}개, 집계 제외)
              </summary>
              <DetailTable rows={auxDetails} hideMetColumn={auxHideMetColumn} />
            </details>
          )}
          {aux2Details && aux2Details.length > 0 && (
            <details>
              <summary className="cursor-pointer select-none text-xs text-zinc-500 hover:text-zinc-300">
                {aux2Label} 보기 ({aux2Details.length}개, 집계 제외)
              </summary>
              <DetailTable rows={aux2Details} hideMetColumn={aux2HideMetColumn} />
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
