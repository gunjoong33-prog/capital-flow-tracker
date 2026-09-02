"use client";

import { useState } from "react";
import styles from "../page.module.css";

export interface InstitutionNote {
  id: string;
  category: string;
  institution: string;
  summary: string;
  createdAt: Date;
  sourceUrl?: string;
  sourceTitle?: string;
}

function fmtDateTime(d: Date) {
  return new Date(d).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
}

// RiskyNewsList.tsx와 같은 패턴 — 기관 버튼을 누르기 전엔 아무 노트도 안 보여준다(65건을 한 번에
// 펼치면 화면이 너무 길어져 가독성이 떨어진다는 게 이번 요청의 취지).
export function InstitutionNotes({ notes }: { notes: InstitutionNote[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  const countByInstitution = new Map<string, number>();
  for (const n of notes) countByInstitution.set(n.institution, (countByInstitution.get(n.institution) ?? 0) + 1);
  const institutions = [...countByInstitution.entries()].sort((a, b) => b[1] - a[1]);

  const shown = selected ? notes.filter((n) => n.institution === selected) : [];

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {institutions.map(([name, count]) => (
          <button
            key={name}
            type="button"
            onClick={() => setSelected(selected === name ? null : name)}
            className={
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors " +
              (selected === name
                ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]"
                : "border-[var(--border)] text-[var(--ink-dim)] hover:border-[var(--accent-strong)] hover:text-[var(--ink)]")
            }
          >
            {name} ({count})
          </button>
        ))}
      </div>

      {shown.map((note) => (
        <div key={note.id} className={styles.noteSample}>
          <div className={styles.noteSampleHead}>
            <span>
              [{note.category}] {note.sourceTitle || note.institution}
            </span>
            <span>{fmtDateTime(note.createdAt)}</span>
          </div>
          <p className={styles.noteSampleBody}>{note.summary}</p>
          {note.sourceUrl && (
            <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>
              원문 보기: {note.sourceTitle || note.sourceUrl}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
