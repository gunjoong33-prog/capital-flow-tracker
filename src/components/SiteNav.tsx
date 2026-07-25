import Link from "next/link";

export function SiteNav({ active }: { active: "home" | "calendar" | "reports" | "manual-input" }) {
  const cls = (key: string) => (key === active ? "text-zinc-100" : "hover:text-zinc-200");
  return (
    <nav className="flex flex-wrap gap-4 text-sm text-zinc-500">
      <Link href="/" className={cls("home")}>오늘의 리포트</Link>
      <Link href="/calendar" className={cls("calendar")}>캘린더</Link>
      <Link href="/reports/weekly" className={cls("reports")}>주기별 리포트</Link>
      <Link href="/manual-input" className={cls("manual-input")}>수동 입력</Link>
    </nav>
  );
}
