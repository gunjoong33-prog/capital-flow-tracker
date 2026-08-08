"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./DateJumpForm.module.css";

/**
 * 캘린더 상단 버튼 — 클릭하면 화면 중앙에 작은 팝업이 뜨고, 년/월/일 선택 후 해당 날짜 리포트로 이동한다.
 * 홈 화면 PPT 카드에서도 재사용한다 — 그쪽은 날짜별 페이지가 따로 없이 "/"에 쿼리 파라미터로 날짜를
 * 넘기는 구조라(page.tsx가 searchParams.date를 읽어 그날 리포트를 조회) asQuery로 목적지 형식을 바꾼다.
 * compact는 "칸 위에 작은 버튼"으로 써야 하는 자리(홈 화면 PPT 카드)에서 트리거 버튼을 더 작게 만든다.
 */
export function DateJumpForm({
  defaultYear,
  defaultMonth,
  defaultDay,
  basePath = "/calendar",
  asQuery = false,
  compact = false,
}: {
  defaultYear: number;
  defaultMonth: number;
  defaultDay: number;
  basePath?: string;
  asQuery?: boolean;
  compact?: boolean;
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
    const dateStr = `${year}-${mm}-${dd}`;
    router.push(asQuery ? `${basePath}?date=${dateStr}` : `${basePath}/${dateStr}`);
    setOpen(false);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className={compact ? `${styles.trigger} ${styles.triggerCompact}` : styles.trigger}>
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
