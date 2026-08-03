import { IBM_Plex_Mono, Mrs_Saint_Delafield } from "next/font/google";

// 홈(지표) 페이지 전용 폰트 — 사이트 전역 레이아웃(layout.tsx의 Geist)과는 분리해서
// 이 페이지에만 적용한다(다른 페이지 스타일에 영향 없음).
//
// Gothic A1·IBM Plex Sans KR(한글 필요)은 여기 안 넣는다 — next/font/google 타입이 이 두
// 폰트에 "korean" 서브셋을 허용하지 않는다(latin/latin-ext만 가능). 고정 서브셋으로 self-host해도
// 실시간 뉴스 헤드라인처럼 매번 바뀌는 한글 텍스트의 글자를 미리 다 못 담아 깨진다 — 대신
// page.tsx에서 Google Fonts CSS2 링크로 불러온다(구글이 유니코드 레인지별로 자동 분할 제공해
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
