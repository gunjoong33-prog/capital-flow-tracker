import { SiteHeader } from "@/components/SiteHeader";
import siteStyles from "@/styles/site.module.css";
import styles from "../about/page.module.css";

export const metadata = {
  title: "이용약관 · 자본 흐름 체크리스트",
};

export default function TermsPage() {
  return (
    <div className={siteStyles.page}>
      <SiteHeader current="home" />
      <div className={siteStyles.wrap} style={{ paddingTop: "2rem", paddingBottom: "3rem" }}>
        <article className={styles.prose}>
          <h1>이용약관</h1>
          <p>최종 수정일: 2026년 8월 16일</p>

          <h2>1. 정보 제공 목적</h2>
          <p>
            이 사이트가 보여주는 점수·행동 제안·리포트는 모두 정보 제공 목적이며,{" "}
            <strong>투자 자문이나 투자 권유가 아닙니다.</strong> 특정 종목이나 상품을 매수·매도하라는
            권유가 아니며, 어떤 형태의 금융 자문업도 등록되어 있지 않습니다.
          </p>

          <h2>2. 데이터의 정확성</h2>
          <p>
            FRED, Yahoo Finance, CFTC, DART, KRX 등 공개 소스에서 데이터를 가져오지만, 원본 소스의
            지연·오류·중단으로 표시값이 틀리거나 늦게 갱신될 수 있습니다. 데이터가 정확하거나
            최신임을 보장하지 않습니다.
          </p>

          <h2>3. 책임의 한계</h2>
          <p>
            이 사이트의 정보를 이용해 내린 투자 판단과 그로 인한 손익은 전적으로 이용자 본인의
            책임입니다. 운영자는 이 사이트의 정보를 근거로 발생한 어떠한 손해에 대해서도 법적
            책임을 지지 않습니다.
          </p>

          <h2>4. 서비스 변경·중단</h2>
          <p>
            개인이 무료로 운영하는 프로젝트 특성상 사전 공지 없이 기능이 변경되거나 서비스가
            중단될 수 있습니다.
          </p>

          <h2>5. 문의</h2>
          <p>
            이 약관에 대한 문의는{" "}
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
