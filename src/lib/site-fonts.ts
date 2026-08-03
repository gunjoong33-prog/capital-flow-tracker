import { IBM_Plex_Mono, Mrs_Saint_Delafield } from "next/font/google";

// 새 디자인 시스템을 쓰는 모든 페이지(지표/뉴스/오늘의 리포트/캘린더/주기별 리포트/홈)가 공유하는
// 폰트 — 사이트 전역 레이아웃(layout.tsx의 Geist)과는 분리해서 이 페이지들에만 적용한다.
//
// Gothic A1·IBM Plex Sans KR(한글 필요)은 여기 안 넣는다 — next/font/google 타입이 이 두
// 폰트에 "korean" 서브셋을 허용하지 않는다(latin/latin-ext만 가능). 고정 서브셋으로 self-host해도
// 실시간 뉴스 헤드라인처럼 매번 바뀌는 한글 텍스트의 글자를 미리 다 못 담아 깨진다 — 대신
// SiteHeader가 Google Fonts CSS2 링크로 불러온다(구글이 유니코드 레인지별로 자동 분할 제공해
// 실제 쓰인 글자만 내려받는다).
export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
});

// 로고 워드마크("Macroeconomic Analysis") 전용 — 본문·헤딩은 전부 산세리프를 쓰고
// 이 스크립트체는 브랜드 마크에만 예외적으로 쓴다.
export const mrsSaintDelafield = Mrs_Saint_Delafield({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-script",
});
