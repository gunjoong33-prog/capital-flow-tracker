"use client";

import { useState } from "react";
import type { RiskyNewsItem } from "@/lib/scoring/types";

type Severity = "high" | "medium" | "low";
type Filter = "all" | Severity;

// 1단계 리스크 뉴스 심각도별 표시 스타일. high=단독으로도 즉시 거부권 발동, medium=명확한 리스크지만
// 실제 조치·확전 신호 수준, low=경고·우려 표명 수준(누적돼야 리스크로 봄) — pure.ts newsItemWeight 참고.
const SEVERITY_STYLE: Record<Severity, { box: string; text: string; badge: string; link: string; label: string }> = {
  high: {
    box: "bg-rose-500/10",
    text: "text-rose-300",
    badge: "bg-rose-500/30 text-rose-200",
    link: "text-rose-400 hover:text-rose-300",
    label: "심각 · 단독 즉시발동",
  },
  medium: {
    box: "bg-amber-500/10",
    text: "text-amber-300",
    badge: "bg-amber-500/30 text-amber-200",
    link: "text-amber-400 hover:text-amber-300",
    label: "중간",
  },
  low: {
    box: "bg-zinc-500/10",
    text: "text-zinc-400",
    badge: "bg-zinc-500/30 text-zinc-300",
    link: "text-zinc-400 hover:text-zinc-300",
    label: "경미 · 누적형",
  },
};

// 심각도 우선순위(버튼 배치 순서 + "전체" 탭의 정렬 기준). 거부권 발동 여부를 가장 크게 좌우하는
// 게 심각도(특히 high 1건이면 그 자체로 즉시 발동)라, 날짜순보다 이 순서로 훑는 게 실제 판단
// 흐름과 맞는다 — 기존엔 정렬 기준이 없어 심각·중간·경미가 뒤섞여 나와 가독성이 떨어졌다.
const SEVERITY_ORDER: Severity[] = ["high", "medium", "low"];

export function RiskyNewsList({ riskyNews }: { riskyNews: RiskyNewsItem[] }) {
  // 처음엔 아무 버튼도 안 눌린 상태(null)라 뉴스 목록을 안 보여준다 — 버튼을 눌러야 그 등급의
  // 뉴스가 나오게 해달라는 요청. 41건이 접힌 채로 시작해 화면이 한결 짧아진다.
  const [filter, setFilter] = useState<Filter | null>(null);

  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const n of riskyNews) counts[n.severity]++;

  const shown =
    filter === null
      ? []
      : filter === "all"
        ? [...riskyNews].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
        : riskyNews.filter((n) => n.severity === filter);

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "전체", count: riskyNews.length },
    { key: "high", label: SEVERITY_STYLE.high.label, count: counts.high },
    { key: "medium", label: SEVERITY_STYLE.medium.label, count: counts.medium },
    { key: "low", label: SEVERITY_STYLE.low.label, count: counts.low },
  ];

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(filter === t.key ? null : t.key)}
            className={
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors " +
              (filter === t.key
                ? "border-zinc-100 bg-zinc-100 text-zinc-900"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200")
            }
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {shown.map((n, i) => {
          const style = SEVERITY_STYLE[n.severity];
          return (
            <div key={i} className={`rounded-md px-3 py-2 text-xs ${style.box}`}>
              <p className={`[word-break:keep-all] ${style.text}`}>
                <span className={`mr-1 rounded px-1 py-0.5 text-[10px] font-medium ${style.badge}`}>{style.label}</span>
                {n.summary}
              </p>
              <a href={n.url} target="_blank" rel="noopener noreferrer" className={`mt-1 inline-block underline ${style.link}`}>
                기사 보기 →
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
