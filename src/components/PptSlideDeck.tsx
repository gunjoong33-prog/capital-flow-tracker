"use client";

import { useState } from "react";
import type { PptSlide, PptSlideVisual } from "@/lib/scoring/types";
import styles from "./PptSlideDeck.module.css";

function toneClass(tone: "pos" | "neg" | "accent" | undefined): string {
  if (tone === "pos") return styles.tonePos;
  if (tone === "neg") return styles.toneNeg;
  if (tone === "accent") return styles.toneAccent;
  return "";
}

function Visual({ visual }: { visual: PptSlideVisual }) {
  if (visual.type === "stat-pair") {
    return (
      <div className={styles.statPair}>
        <div className={styles.stat}>
          <div className={`${styles.statValue} ${toneClass(visual.left.tone)}`}>{visual.left.value}</div>
          <div className={styles.statLabel}>{visual.left.label}</div>
        </div>
        <div className={styles.stat}>
          <div className={`${styles.statValue} ${toneClass(visual.right.tone)}`}>{visual.right.value}</div>
          <div className={styles.statLabel}>{visual.right.label}</div>
        </div>
      </div>
    );
  }
  if (visual.type === "bar-pair") {
    return (
      <div className={styles.barChart}>
        {[visual.left, visual.right].map((bar, i) => (
          <div className={styles.barCol} key={i}>
            <div className={`${styles.barValue} ${i === 0 ? styles.toneAccent : ""}`}>{bar.value}</div>
            <div className={styles.bar} style={{ height: `${Math.max(bar.heightPct, 6)}%`, background: i === 0 ? "var(--accent-strong)" : "var(--border)" }} />
            <div className={styles.barLabel}>{bar.label}</div>
          </div>
        ))}
      </div>
    );
  }
  if (visual.type === "ratio-bar") {
    const pct = visual.total > 0 ? (visual.qualifying / visual.total) * 100 : 0;
    return (
      <div className={styles.ratioWrap}>
        <div className={styles.ratioTrack}>
          <div className={styles.ratioFill} style={{ width: `${pct}%` }} />
        </div>
        <div className={styles.ratioLabel}>
          {visual.label} {visual.qualifying} / {visual.total}
        </div>
      </div>
    );
  }
  if (visual.type === "weight-bars") {
    return (
      <div className={styles.weightBars}>
        {visual.rows.map((row) => (
          <div className={styles.weightRow} key={row.label}>
            <span className={styles.weightLabel}>{row.label}</span>
            <div className={styles.weightTrack}>
              <div className={styles.weightFill} style={{ width: `${Math.min(100, (row.score / 10) * 100)}%` }} />
            </div>
            <span className={styles.weightScore}>{row.score.toFixed(1)}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export function PptSlideDeck({ slides }: { slides: PptSlide[] }) {
  const [i, setI] = useState(0);
  if (slides.length === 0) return null;
  const slide = slides[i];
  const go = (delta: number) => setI((prev) => (prev + delta + slides.length) % slides.length);

  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <span className={styles.kicker}>{slide.kicker}</span>
        <span className={styles.pageLabel}>{i + 1} / {slides.length}</span>
      </div>
      <div className={styles.body}>
        <div>
          <div className={styles.headline}>{slide.headline}</div>
          {slide.body && <div className={styles.sub}>{slide.body}</div>}
        </div>
        <Visual visual={slide.visual} />
      </div>
      <div className={styles.bottom}>
        <div className={styles.dots}>
          {slides.map((s, idx) => (
            <button
              key={s.step}
              type="button"
              aria-label={`${idx + 1}번 슬라이드로 이동`}
              className={`${styles.dot} ${idx === i ? styles.dotActive : ""}`}
              onClick={() => setI(idx)}
            />
          ))}
        </div>
        <div className={styles.nav}>
          <button type="button" aria-label="이전 슬라이드" className={styles.navBtn} onClick={() => go(-1)}>‹</button>
          <button type="button" aria-label="다음 슬라이드" className={styles.navBtn} onClick={() => go(1)}>›</button>
        </div>
      </div>
    </div>
  );
}
