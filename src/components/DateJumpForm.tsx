"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./DateJumpForm.module.css";

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

  return (
    <>
      <button onClick={() => setOpen(true)} className={styles.trigger}>
        날짜로 이동
      </button>

      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modal__head}>
              <h2 className={styles.modal__title}>날짜로 이동</h2>
              <button onClick={() => setOpen(false)} className={styles.modal__close} aria-label="닫기">
                ✕
              </button>
            </div>
            <div className={styles.selectRow}>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={styles.select}>
                {years.map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={styles.select}>
                {months.map((m) => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
              <select value={selectedDay} onChange={(e) => setDay(Number(e.target.value))} className={styles.select}>
                {days.map((d) => (
                  <option key={d} value={d}>{d}일</option>
                ))}
              </select>
            </div>
            <button onClick={goToDate} className={styles.goBtn}>
              이동하기
            </button>
          </div>
        </div>
      )}
    </>
  );
}
