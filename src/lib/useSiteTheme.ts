"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "home-theme";
export const SITE_THEME_EVENT = "site-theme-change";

/** HomeThemeToggle이 바꾸는 다크·라이트 상태를 다른 클라이언트 컴포넌트에서도 구독한다
 * (TradingView 위젯처럼 colorTheme을 직접 넘겨야 하는 서드파티 임베드용 — CSS 변수만으로는
 * 못 바꾼다). localStorage로 초기값을 읽고, 토글이 쏘는 커스텀 이벤트로 실시간 갱신된다. */
export function useSiteTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") setTheme(saved);

    function onChange(e: Event) {
      const next = (e as CustomEvent<"dark" | "light">).detail;
      if (next === "light" || next === "dark") setTheme(next);
    }
    window.addEventListener(SITE_THEME_EVENT, onChange);
    return () => window.removeEventListener(SITE_THEME_EVENT, onChange);
  }, []);

  return theme;
}
