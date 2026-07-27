import type { ReactNode } from "react";
import type { StepDetailRow } from "@/lib/scoring/types";

/** "Fed 대차대조표(WALCL)" -> 본명 + 코드로 나눈다 — 괄호가 좁은 열 안에서 줄바꿈되며 읽기 불편해지는 걸 막는다. */
function splitLabel(label: string): { main: string; code: string | null } {
  const match = label.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  return match ? { main: match[1], code: match[2] } : { main: label, code: null };
}

/** 표 행 하나에서 두 레이아웃(데스크톱 표/모바일 카드)이 공통으로 쓰는 파싱만 미리 해둔다. */
function parseRow(row: StepDetailRow) {
  // run.ts가 "핵심값 — 부가설명 — 부가설명2" 형태로 값을 만드는 경우가 많다 — 나눠서
  // 핵심값은 굵게, 부가설명은 각각 줄을 나눠 작은 보조 텍스트로 분리해야 표가 안 빽빽해진다.
  const [mainValue, ...noteParts] = row.value.split(" — ");
  const { main: labelMain, code: labelCode } = splitLabel(row.label);
  return { mainValue, noteParts, labelMain, labelCode };
}

/**
 * hideMetColumn=true면 마지막 열 자체를 없앤다(순수 실제값 나열용, 예: 5단계 마감가 원자료).
 * row.result가 있으면 마지막 열 헤더를 "결과"로 바꾸고 ✓/✕ 아이콘 대신 텍스트를 보여준다
 * (충족/불충족으로 나누기 애매한 범주형 판정용, 예: 5단계 위험선호/쏠림 여부).
 * wideCriterion=true면 지표열을 줄이고 기준열을 늘린다(기준 문장이 긴 표의 가독성용, 예: 6단계).
 * narrowCriterion=true면 반대로 기준열을 줄이고 실제값열을 늘린다(기준은 짧고 실제값이 긴 서술형 표용,
 * 예: 7단계 기관·내부자 매집).
 * row.url이 하나라도 있으면 "바로가기" 열이 자동으로 추가돼 원본 출처 링크를 보여준다.
 */
function DetailTable({
  rows,
  hideMetColumn = false,
  wideCriterion = false,
  narrowCriterion = false,
}: {
  rows: StepDetailRow[];
  hideMetColumn?: boolean;
  wideCriterion?: boolean;
  narrowCriterion?: boolean;
}) {
  const resultMode = rows.some((r) => r.result !== undefined);
  const linkMode = rows.some((r) => r.url);
  const metHeader = resultMode ? "결과" : "충족";

  /** 충족/결과 열 내용 — 표·카드 레이아웃에서 공통으로 쓴다. */
  function MetCell({ row }: { row: StepDetailRow }) {
    if (row.result !== undefined) return <span className="text-zinc-300">{row.result}</span>;
    if (row.met === null) return <span className="text-zinc-600">-</span>;
    return row.met ? <span className="text-emerald-400">✓</span> : <span className="text-rose-400">✕</span>;
  }

  return (
    <div className="mt-2 rounded-lg border border-zinc-800">
      {/* 데스크톱(md 이상): 기존 4~5열 표 그대로 유지. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full table-fixed text-xs">
          <colgroup>
            <col className={narrowCriterion ? "w-[20%]" : wideCriterion ? "w-[18%]" : "w-[26%]"} />
            <col className={narrowCriterion ? "w-[14%]" : hideMetColumn ? "w-[36%]" : resultMode ? "w-[18%]" : wideCriterion ? "w-[40%]" : "w-[32%]"} />
            <col className={narrowCriterion ? (linkMode ? "w-[54%]" : "w-[66%]") : hideMetColumn ? "w-[38%]" : resultMode ? "w-[36%]" : "w-[34%]"} />
            {!hideMetColumn && <col className={resultMode ? "w-[20%]" : "w-[8%]"} />}
            {linkMode && <col className="w-[12%]" />}
          </colgroup>
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/60 text-left text-zinc-500">
              <th className="px-3 py-2 font-normal">지표</th>
              <th className="px-3 py-2 font-normal">기준</th>
              <th className="px-3 py-2 font-normal">실제값</th>
              {!hideMetColumn && <th className="px-3 py-2 font-normal">{metHeader}</th>}
              {linkMode && <th className="px-3 py-2 font-normal">바로가기</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              // (예: 5단계 빅테크는 마감가 / 전일 대비 변동 / 등락 원인 3줄로 나뉜다).
              const { mainValue, noteParts, labelMain, labelCode } = parseRow(row);
              return (
                <tr key={i} className="border-b border-zinc-800/60 align-top last:border-0">
                  <td className="px-3 py-2.5">
                    {/* [word-break:keep-all]: 좁은 열에서 한글 단어가 음절 중간에 끊겨 다음 줄로
                        넘어가는 걸 막는다(예: "신규매수"가 "신"/"규매수"로 갈라지는 문제) — 단어
                        전체가 통째로 다음 줄로 내려가게 한다. */}
                    <div className="[word-break:keep-all] text-zinc-300">{labelMain}</div>
                    {labelCode && <div className="mt-0.5 text-[10px] text-zinc-600">{labelCode}</div>}
                  </td>
                  <td className="[word-break:keep-all] px-3 py-2.5 leading-relaxed text-zinc-500">{row.criterion}</td>
                  <td className="px-3 py-2.5">
                    {/* whitespace-pre-line: run.ts가 한 부가설명 안에 "\n"으로 여러 항목을 이어붙이는
                        경우(예: 7단계 기관·내부자 매집의 매매 목록)가 있다 — 기본 white-space:normal은
                        \n을 공백으로 뭉개버려서 전부 한 문단으로 붙고, 그 문단이 좁은 열 너비에서
                        임의의 지점(단어 중간일 수도 있음)에서 줄바꿈된다. pre-line으로 \n을 실제
                        줄바꿈으로 살려야 의도한 자리에서 줄이 나뉜다.
                        word-break:keep-all: 기본값은 한글 음절 사이 어디서나 줄바꿈을
                        허용해서 "신규매수"가 "신" / "규매수"로 갈라지는 식으로 잘린다 — 공백이 있는
                        지점에서만 줄바꿈되게 막는다. */}
                    <div className="whitespace-pre-line [word-break:keep-all] font-medium text-zinc-200">{mainValue}</div>
                    {noteParts.map((part, j) => (
                      <div key={j} className="mt-0.5 whitespace-pre-line [word-break:keep-all] leading-snug text-zinc-500">{part}</div>
                    ))}
                  </td>
                  {!hideMetColumn && (
                    <td className="px-3 py-2.5">
                      <MetCell row={row} />
                    </td>
                  )}
                  {linkMode && (
                    <td className="px-3 py-2.5">
                      {row.url ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-400 underline hover:text-zinc-200"
                        >
                          확인 →
                        </a>
                      ) : (
                        <span className="text-zinc-600">-</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 모바일(md 미만): 4~5열을 억지로 욱여넣으면 한 칸에 몇 글자씩만 들어가 읽기 어렵다 —
          같은 데이터를 행별 카드로 세로 배치해서 각 항목에 전체 너비를 준다. */}
      <div className="divide-y divide-zinc-800 md:hidden">
        {rows.map((row, i) => {
          const { mainValue, noteParts, labelMain, labelCode } = parseRow(row);
          return (
            <div key={i} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="[word-break:keep-all] text-sm text-zinc-300">
                  {labelMain}
                  {labelCode && <span className="ml-1 text-[11px] text-zinc-600">{labelCode}</span>}
                </div>
                {!hideMetColumn && <div className="shrink-0 pt-0.5 text-sm"><MetCell row={row} /></div>}
              </div>
              <div className="[word-break:keep-all] mt-1 text-xs leading-relaxed text-zinc-500">{row.criterion}</div>
              <div className="whitespace-pre-line [word-break:keep-all] mt-1.5 text-sm font-medium text-zinc-200">{mainValue}</div>
              {noteParts.map((part, j) => (
                <div key={j} className="whitespace-pre-line [word-break:keep-all] mt-0.5 text-xs leading-snug text-zinc-500">{part}</div>
              ))}
              {linkMode && row.url && (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-block text-xs text-zinc-400 underline hover:text-zinc-200"
                >
                  바로가기 →
                </a>
              )}
            </div>
          );
        })}
      </div>
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
  auxNarrowCriterion,
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
  auxNarrowCriterion?: boolean;
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
              <DetailTable rows={auxDetails} hideMetColumn={auxHideMetColumn} narrowCriterion={auxNarrowCriterion} />
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
    // 모바일에서 값이 긴 문장(예: 1단계 "사유")이면 라벨까지 같이 눌려서 "사"/"유"처럼 음절이
    // 갈라졌다 — 라벨은 shrink-0으로 항상 온전히 보이게 하고, 좁은 화면에서는 라벨/값을
    // 가로 배치 대신 세로로 쌓아서 각자 전체 너비를 쓰게 한다(데스크톱은 기존 가로 배치 그대로).
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-800/60 py-1.5 last:border-0 max-sm:flex-col max-sm:items-start max-sm:gap-0.5">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <span className="font-medium text-zinc-100">{value}</span>
    </div>
  );
}
