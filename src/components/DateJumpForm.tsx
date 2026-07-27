"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** 캘린더 상단의 년/월/일 선택 후 해당 날짜 리포트로 바로 이동하는 폼. */
export function DateJumpForm({
  defaultYear,
  defaultMonth,
  defaultDay,
}: {
  defaultYear: number;
  defaultMonth: number;
  defaultDay: number;
}) {
  const router = useRouter();
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [day, setDay] = useState(defaultDay);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const selectedDay = Math.min(day, daysInMonth);

  const years = Array.from({ length: 4 }, (_, i) => defaultYear - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  function goToDate() {
    const mm = String(month).padStart(2, "0");
    const dd = String(selectedDay).padStart(2, "0");
    router.push(`/calendar/${year}-${mm}-${dd}`);
  }

  const selectCls = "rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectCls}>
        {years.map((y) => (
          <option key={y} value={y}>{y}년</option>
        ))}
      </select>
      <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={selectCls}>
        {months.map((m) => (
          <option key={m} value={m}>{m}월</option>
        ))}
      </select>
      <select value={selectedDay} onChange={(e) => setDay(Number(e.target.value))} className={selectCls}>
        {days.map((d) => (
          <option key={d} value={d}>{d}일</option>
        ))}
      </select>
      <button
        onClick={goToDate}
        className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
      >
        해당 날짜로 이동
      </button>
    </div>
  );
}
