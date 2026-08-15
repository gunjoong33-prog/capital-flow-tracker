"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "home-theme";
export const SITE_THEME_EVENT = "site-theme-change";

function subscribe(onStoreChange: () => void) {
  window.addEventListener(SITE_THEME_EVENT, onStoreChange);
  return () => window.removeEventListener(SITE_THEME_EVENT, onStoreChange);
}

function getSnapshot(): "dark" | "light" {
  return window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
}

function getServerSnapshot(): "dark" | "light" {
  return "dark";
}

/** HomeThemeToggle이 바꾸는 다크·라이트 상태를 다른 클라이언트 컴포넌트에서도 구독한다
 * (TradingView 위젯처럼 colorTheme을 직접 넘겨야 하는 서드파티 임베드용 — CSS 변수만으로는
 * 못 바꾼다). localStorage를 외부 스토어로 보고 useSyncExternalStore로 읽는다.
 *
 * 예전엔 useState("dark") 기본값을 useEffect 안에서 localStorage 값으로 고쳐 쓰는 방식이었는데,
 * 두 가지 문제가 있었다 — ①"setState in effect" 패턴이라 react-hooks/set-state-in-effect 린트
 * 규칙에 걸림 ②그 교정이 첫 페인트 "이후"에 일어나 하드코딩된 기본값이 한 프레임 노출됐다
 * (TradingView 위젯이 이 값을 config.colorTheme으로 즉시 받아서 재마운트되는 원인이기도 했다).
 * useSyncExternalStore는 마운트 시점에 getSnapshot()으로 즉시 올바른 값을 동기적으로 읽어와서
 * 두 문제를 한 번에 없앤다 — setState를 직접 호출하지 않고, effect의 교정 프레임도 필요 없다.
 * getServerSnapshot은 서버 렌더 시 항상 "dark"를 돌려줘 하이드레이션 불일치도 안 생긴다(클라이언트
 * 첫 렌더도 하이드레이션 중에는 서버와 같은 값을 쓰고, 커밋 이후에야 실제 저장값으로 다시 그린다 —
 * React의 useSyncExternalStore 자체 동작). */
export function useSiteTheme(): "dark" | "light" {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
