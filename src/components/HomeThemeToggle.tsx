"use client";

import { useEffect, useState } from "react";
import styles from "@/styles/site.module.css";

const STORAGE_KEY = "home-theme";

/** 새 디자인 시스템 페이지 전용 다크·라이트 토글 — <html data-home-theme>를 직접 건드린다
 * (기존 zinc 다크 고정 페이지는 이 속성을 안 봐서 영향 없음). */
export function HomeThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      document.documentElement.setAttribute("data-home-theme", saved);
    }
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.setAttribute("data-home-theme", next);
  }

  return (
    <div className={styles.themeSwitch}>
      <span className={styles.themeSwitch__label}>{theme === "dark" ? "다크 모드" : "라이트 모드"}</span>
      <button
        type="button"
        className={styles.themeSwitch__track}
        role="switch"
        aria-checked={theme === "dark"}
        aria-label="다크·라이트 모드 전환"
        onClick={toggle}
      >
        <span className={styles.themeSwitch__thumb} />
      </button>
    </div>
  );
}
