import { SiteHeader } from "@/components/SiteHeader";
import { ibmPlexMono, mrsSaintDelafield } from "@/lib/site-fonts";
import siteStyles from "@/styles/site.module.css";
import styles from "../about/page.module.css";

export const metadata = {
  title: "개인정보처리방침 · 자본 흐름 체크리스트",
};

export default function PrivacyPage() {
  return (
    <div className={`${siteStyles.page} ${ibmPlexMono.variable} ${mrsSaintDelafield.variable}`}>
      <SiteHeader current="home" />
      <div className={siteStyles.wrap} style={{ paddingTop: "2rem", paddingBottom: "3rem" }}>
        <article className={styles.prose}>
          <h1>개인정보처리방침</h1>
          <p>최종 수정일: 2026년 8월 16일</p>

          <h2>회원가입·로그인 없음</h2>
          <p className={styles.sentences}>
            <span>이 사이트는 회원가입·로그인 기능이 없습니다.</span>
            <span>이름, 이메일 등 개인을 식별할 수 있는 정보를 입력받거나 저장하지 않습니다.</span>
          </p>

          <h2>쿠키·추적</h2>
          <p>
            자체적으로 쿠키를 설정하거나, 방문자 행동을 추적하는 분석 스크립트(구글 애널리틱스
            등)를 사용하지 않습니다.
          </p>

          <h2>서버 로그</h2>
          <p className={styles.sentences}>
            <span>호스팅사(Vercel)가 서비스 운영을 위해 표준적으로 남기는 접속 로그(IP, 요청 시각, 요청 경로 등)가 있을 수 있으며, 이는 Vercel의 자체 정책에 따라 처리됩니다.</span>
            <span>이 로그를 운영자가 별도로 수집·분석하지 않습니다.</span>
          </p>

          <h2>외부 링크</h2>
          <p className={styles.sentences}>
            <span>각 지표의 &ldquo;바로가기&rdquo; 링크는 FRED·Yahoo Finance 등 외부 사이트로 연결됩니다.</span>
            <span>외부 사이트에서의 개인정보 처리는 해당 사이트의 정책을 따릅니다.</span>
          </p>

          <h2>문의</h2>
          <p>
            개인정보 관련 문의는{" "}
            <a href="https://github.com/gunjoong33-prog/capital-flow-tracker" target="_blank" rel="noopener noreferrer">
              GitHub 저장소
            </a>{" "}
            이슈로 남겨주세요.
          </p>
        </article>
      </div>
    </div>
  );
}
