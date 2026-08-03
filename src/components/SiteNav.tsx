import Link from "next/link";

export function SiteNav({ active }: { active: "landing" | "news" | "report" | "calendar" | "reports" }) {
  const cls = (key: string) => (key === active ? "text-zinc-100" : "hover:text-zinc-200");
  return (
    <nav className="flex flex-wrap gap-4 text-sm text-zinc-500">
      <Link href="/" className={cls("landing")}>지표</Link>
      <Link href="/news" className={cls("news")}>뉴스</Link>
      <Link href="/report" className={cls("report")}>오늘의 리포트</Link>
      <Link href="/calendar" className={cls("calendar")}>캘린더</Link>
      <Link href="/reports/weekly" className={cls("reports")}>주기별 리포트</Link>
    </nav>
  );
}
