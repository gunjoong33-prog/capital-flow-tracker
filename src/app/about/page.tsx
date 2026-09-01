import { SiteHeader } from "@/components/SiteHeader";
import siteStyles from "@/styles/site.module.css";
import styles from "./page.module.css";

export const metadata = {
  title: "소개 · 자본 흐름 체크리스트",
};

export default function AboutPage() {
  return (
    <div className={siteStyles.page}>
      <SiteHeader current="home" />
      <div className={siteStyles.wrap} style={{ paddingTop: "2rem", paddingBottom: "3rem" }}>
        <article className={styles.prose}>
          <h1>소개</h1>
          <p>
            자본 흐름 체크리스트는 매일 아침 9시(한국시간) 거시경제 데이터를 8단계 규칙에 따라
            점검해, 그날의 투자 적합도 점수와 참고용 행동(매수 / 지켜보기 / 현금비중늘리기)을
            보여주는 개인 프로젝트입니다. 2026년 7월 27일부터 매일 자동으로 갱신됩니다.
          </p>
          <h2>운영 형태</h2>
          <p>
            법인이나 사업자가 아닌 개인이 만들고 무료로 운영하는 사이드 프로젝트입니다. 별도
            고객센터나 회사 조직은 없습니다. 문의·오류 제보는{" "}
            <a href="https://github.com/gunjoong33-prog/capital-flow-tracker" target="_blank" rel="noopener noreferrer">
              GitHub 저장소
            </a>
            의 이슈로 남겨주시면 확인합니다.
          </p>
          <h2>방법론</h2>
          <p>
            8단계 프레임워크와 유동성 중심 가중치는 Michael Howell(CrossBorder Capital)의 글로벌
            유동성 분석 틀을 참고해 만들었습니다. 각 단계의 가중치는 학술적으로 검증된 공식이
            아니라, 이 프레임워크를 참고한 경험적 추정값입니다 — 각 지표의 상세 화면에 실제
            가중치와 계산식을 그대로 노출합니다.
          </p>
          <h2>참고 리서치 원문</h2>
          <p>
            이 사이트의 자동 계산 외에, 아래 기관들이 로그인 없이 공개하는 리서치 원문도 직접
            확인해보실 수 있습니다.
          </p>
          <ul>
            <li>
              <a href="https://finance.naver.com/research/" target="_blank" rel="noopener noreferrer">
                네이버금융 리서치
              </a>{" "}
              (국내 증권사 PDF 모음)
            </li>
            <li>
              <a href="https://www.sec.gov/edgar/search/" target="_blank" rel="noopener noreferrer">
                SEC EDGAR
              </a>{" "}
              (미국 기업 공시 전문)
            </li>
            <li>
              <a href="https://www.bis.org/publ/qtrpdf/qtr_index.htm" target="_blank" rel="noopener noreferrer">
                BIS Quarterly Review
              </a>
            </li>
            <li>
              <a href="https://www.bok.or.kr/portal/bbs/B0000246/list.do" target="_blank" rel="noopener noreferrer">
                한국은행
              </a>{" "}
              (경제전망보고서 등)
            </li>
            <li>
              <a href="https://www.kcmi.re.kr" target="_blank" rel="noopener noreferrer">
                자본시장연구원
              </a>
            </li>
            <li>
              <a href="https://www.federalreserve.gov/publications.htm" target="_blank" rel="noopener noreferrer">
                미 연준(Fed)
              </a>{" "}
              보도자료·연설문·보고서
            </li>
            <li>
              <a href="https://www.ecb.europa.eu/press/pubbydate/html/index.en.html" target="_blank" rel="noopener noreferrer">
                ECB
              </a>
            </li>
            <li>
              <a href="https://www.worldbank.org/en/research" target="_blank" rel="noopener noreferrer">
                World Bank
              </a>
            </li>
            <li>
              <a
                href="https://am.jpmorgan.com/us/en/asset-management/adv/insights/market-insights/guide-to-the-markets/"
                target="_blank"
                rel="noopener noreferrer"
              >
                JPMorgan Asset Management
              </a>{" "}
              &quot;Guide to the Markets&quot;(분기 PDF)
            </li>
          </ul>

          <h2>운영 기간이 짧다는 점</h2>
          <p>
            2026년 7월 27일 이후로 아직 운영 기간이 길지 않아, 신호의 장기 정확도는 검증되지
            않았습니다. 참고 자료로만 활용하시고, 이 사이트의 신호만으로 투자 결정을 내리지
            마세요. 자세한 면책 조항은{" "}
            <a href="/terms">이용약관</a>을 참고하세요.
          </p>
        </article>
      </div>
    </div>
  );
}
