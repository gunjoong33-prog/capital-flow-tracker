import type { ReactNode } from "react";
import styles from "./page.module.css";

/** "→ 요약문장" 줄만 굵게 강조해서 나머지 설명과 시각적으로 구분한다(가독성 최적화). */
export function TipText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <p key={i} className={line.startsWith("→") ? styles.tipLineHighlight : undefined}>
          {line}
        </p>
      ))}
    </>
  );
}

/** 카드 바깥은 항상 내용물 높이에 맞춰 자동으로 늘어난다("?" 팁이 펼쳐지면 카드가 그만큼
 * 커지고, 아래 형제 요소들이 밀려난다) — 고정 높이는 bodyClass(본문 위젯 영역)에만 준다.
 * 예전엔 카드 자체를 고정 높이로 잡아서 팁이 펼쳐지면 내용이 넘쳐 아래 카드·캡션을
 * 가리는 문제가 있었다(실사용 확인). */
export function WidgetCard({
  title,
  bodyClass,
  tip,
  children,
}: {
  title: string;
  bodyClass: string;
  tip?: string;
  children: ReactNode;
}) {
  const tipId = tip ? `indicators-tip-${title}` : undefined;
  return (
    <div className={styles.widget}>
      {tip && <input type="checkbox" id={tipId} className={styles.tipCheckbox} />}
      <div className={styles.widget__head}>
        <span className={styles.widget__title}>{title}</span>
        {tip && (
          <label htmlFor={tipId} className={styles.widget__tip}>
            ?
          </label>
        )}
      </div>
      {tip && (
        <div className={styles.widget__tipBox}>
          <TipText text={tip} />
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </div>
  );
}
