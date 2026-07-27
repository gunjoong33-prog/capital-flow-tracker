"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** 캘린더 상단 버튼 — 클릭하면 화면 중앙에 작은 팝업이 뜨고, 년/월/일 선택 후 해당 날짜 리포트로 이동한다. */
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
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [day, setDay] = useState(defaultDay);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const selectedDay = Math.min(day, daysInMonth);

  const years = Array.from({ length: 4 }, (_, i) => defaultYear - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function goToDate() {
    const mm = String(month).padStart(2, "0");
    const dd = String(selectedDay).padStart(2, "0");
    router.push(`/calendar/${year}-${mm}-${dd}`);
    setOpen(false);
  }

  const selectCls = "rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
      >
        날짜로 이동
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xs rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-200">날짜로 이동</h2>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300" aria-label="닫기">
                ✕
              </button>
            </div>
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
            </div>
            <button
              onClick={goToDate}
              className="mt-4 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
            >
              이동하기
            </button>
          </div>
        </div>
      )}
    </>
  );
}
