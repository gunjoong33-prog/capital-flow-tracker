import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { ibmPlexMono, mrsSaintDelafield } from "@/lib/site-fonts";
import siteStyles from "@/styles/site.module.css";

export default function DailyReportNotFound() {
  return (
    <div
      className={`${siteStyles.page} ${ibmPlexMono.variable} ${mrsSaintDelafield.variable}`}
      style={{
        ["--font-gothic" as string]: "'Gothic A1', sans-serif",
        ["--font-sans" as string]: "'IBM Plex Sans KR', sans-serif",
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@500;700;800&family=IBM+Plex+Sans+KR:wght@400;600&display=swap"
      />
      <SiteHeader current="calendar" />
      <div className={siteStyles.wrap} style={{ maxWidth: "52rem", paddingBlock: "1.6rem 3rem" }}>
        <div className={siteStyles.card} style={{ padding: "2.5rem", textAlign: "center" }}>
          <p style={{ fontSize: "1.125rem", fontWeight: 500, color: "var(--ink)" }}>존재하지 않습니다.</p>
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "var(--ink-faint)" }}>
            해당 날짜의 리포트를 찾을 수 없습니다.
          </p>
          <Link
            href="/calendar"
            className={`${siteStyles.pill} ${siteStyles["pill--neutral"]}`}
            style={{ marginTop: "1.5rem", display: "inline-flex" }}
          >
            캘린더로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
