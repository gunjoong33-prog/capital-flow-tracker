import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";

export default function DailyReportNotFound() {
  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto max-w-3xl space-y-6">
        <SiteNav active="calendar" />
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-10 text-center">
          <p className="text-lg font-medium text-zinc-200">존재하지 않습니다.</p>
          <p className="mt-2 text-sm text-zinc-500">해당 날짜의 리포트를 찾을 수 없습니다.</p>
          <Link
            href="/calendar"
            className="mt-6 inline-block rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700"
          >
            캘린더로 돌아가기
          </Link>
        </div>
      </main>
    </div>
  );
}
