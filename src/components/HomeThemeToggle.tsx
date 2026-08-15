"use client";

import { useEffect } from "react";
import styles from "@/styles/site.module.css";
import { SITE_THEME_EVENT, useSiteTheme } from "@/lib/useSiteTheme";

const STORAGE_KEY = "home-theme";

/** 새 디자인 시스템 페이지 전용 다크·라이트 토글 — <html data-home-theme>를 직접 건드린다
 * (기존 zinc 다크 고정 페이지는 이 속성을 안 봐서 영향 없음).
 *
 * 상태는 useSiteTheme()에서 그대로 읽어온다 — 예전엔 이 컴포넌트가 useState("dark")로 자기만의
 * 복사본을 따로 들고 있어서, useSiteTheme.ts의 복사본과 마운트 타이밍에 따라 서로 다른 값을 잠깐
 * 보여줄 수 있었다(스위치 표시가 실제 화면과 안 맞아 보이던 문제의 근본 원인). 진짜 값의 출처는
 * localStorage 하나뿐이므로, 두 곳 다 useSyncExternalStore 기반의 같은 훅을 구독하게 통일한다. */
export function HomeThemeToggle() {
  const theme = useSiteTheme();

  useEffect(() => {
    document.documentElement.setAttribute("data-home-theme", theme);
  }, [theme]);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(STORAGE_KEY, next);
    // TradingView 위젯처럼 CSS 변수로는 못 바꾸고 colorTheme을 직접 넘겨야 하는 서드파티
    // 임베드가 실시간으로 반응하도록 알린다 — useSiteTheme.ts의 구독자(자기 자신 포함)가
    // 이 이벤트를 받아 localStorage를 다시 읽고 리렌더한다.
    window.dispatchEvent(new CustomEvent(SITE_THEME_EVENT, { detail: next }));
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
