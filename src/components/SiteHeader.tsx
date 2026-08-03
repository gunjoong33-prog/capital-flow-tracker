import Link from "next/link";
import { HomeThemeToggle } from "@/components/HomeThemeToggle";
import styles from "@/styles/site.module.css";

export type SitePage = "indicators" | "news" | "report" | "calendar" | "reports" | "home";

const NAV_ITEMS: { href: string; label: string; key: SitePage }[] = [
  { href: "/indicators", label: "지표", key: "indicators" },
  { href: "/news", label: "뉴스", key: "news" },
  { href: "/report", label: "오늘의 리포트", key: "report" },
  { href: "/calendar", label: "캘린더", key: "calendar" },
  { href: "/reports/weekly", label: "주기별 리포트", key: "reports" },
];

/** 좌측 상단 스크립트체 로고("Macroeconomic Analysis") + 내비 + 다크/라이트 토글 — 새 디자인 시스템을
 * 쓰는 모든 페이지가 공유한다. 로고를 누르면 항상 홈("/")으로 이동한다. */
export function SiteHeader({ current }: { current: SitePage }) {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brandLink}>
        <span className={styles.brand__logo}>Macroeconomic Analysis</span>
      </Link>
      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className={item.key === current ? styles.navCurrent : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>
      <HomeThemeToggle />
    </header>
  );
}
