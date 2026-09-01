import Link from "next/link";
import { db } from "@/lib/db";
import { SiteHeader } from "@/components/SiteHeader";
import { ibmPlexMono, mrsSaintDelafield } from "@/lib/site-fonts";
import siteStyles from "@/styles/site.module.css";
import styles from "../page.module.css";

export const dynamic = "force-dynamic"; // 수집·증류가 계속 쌓이므로 항상 최신 조회

export const metadata = {
  title: "자가학습 · 자본 흐름 체크리스트",
};

// institutional-research.ts(SOURCE_LABEL)와 learning-distill.ts(CATEGORY_BY_SOURCE_TYPE)에 흩어진
// sourceType들을 이 페이지 표시용으로만 다시 이름 붙인다 — DB에는 원문 sourceType이 그대로 남는다.
const SOURCE_TYPE_LABEL: Record<string, string> = {
  "13f": "SEC 13F(헤지펀드 포지셔닝)",
  bis: "BIS(국제결제은행)",
  domestic_broker: "국내 증권사 컨센서스",
  finnhub: "Finnhub 애널리스트 등급",
  news_quote: "뉴스 인용(월가 은행 전망)",
  naver_research: "국내 증권사(네이버금융)",
  sec_8k: "SEC 8-K 공시",
  fed: "미 연준(Fed)",
  ecb: "ECB",
  world_bank: "World Bank",
  pimco: "PIMCO",
  blackrock: "BlackRock",
  bis_qr: "BIS Quarterly Review",
  bok_report: "한국은행",
  kcmi_report: "자본시장연구원",
  jpm_am: "JPMorgan Asset Management",
  miraeasset_research: "미래에셋증권",
};

function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium" });
}
function fmtDateTime(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
}

export default async function SelfLearningPage() {
  const [collectionBySource, totalCollected, firstCollected, notesByCategory, totalNotes, latestNote, notesBySourceName] =
    await Promise.all([
      db.externalConsensus.groupBy({ by: ["sourceType"], _count: { _all: true }, _max: { date: true } }),
      db.externalConsensus.count(),
      db.externalConsensus.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      db.learningNote.groupBy({ by: ["category"], _count: { _all: true }, _max: { createdAt: true } }),
      db.learningNote.count(),
      db.learningNote.findFirst({ orderBy: { createdAt: "desc" } }),
      db.learningNote.groupBy({ by: ["sourceName"], _count: { _all: true } }),
    ]);

  const duplicateNoteRows = notesBySourceName
    .filter((g) => g._count._all > 1)
    .reduce((sum, g) => sum + (g._count._all - 1), 0);

  const collecting = totalCollected > 0;
  const distilling = totalNotes > 0;

  return (
    <div className={`${siteStyles.page} ${ibmPlexMono.variable} ${mrsSaintDelafield.variable}`}>
      <SiteHeader current="correction-process" />
      <div className={siteStyles.wrap} style={{ paddingTop: "1.5rem", paddingBottom: "3rem" }}>
        <h1 className={styles.title}>자가학습</h1>

        <nav className={styles.subNav}>
          <Link href="/correction-process" className={styles.subNavLink}>
            자동 수정
          </Link>
          <span className={`${styles.subNavLink} ${styles.subNavLinkCurrent}`}>자가학습</span>
        </nav>

        <div className={styles.explainer}>
          <div className={styles.explainerRow}>
            <span className={styles.explainerTag}>작동 방식</span>
            <p className={styles.explainerText}>
              <span>
                소개 페이지에 공개한 기관 리서치 출처(네이버금융·SEC·연준·ECB·World Bank·PIMCO·BlackRock 등)를 정기적으로
                수집합니다.
              </span>
              <span>모은 자료를 LLM으로 다시 읽혀, 각 기관의 다음 세 가지를 학습 노트로 남깁니다.</span>
              <span>
                <strong>① 어떤 지표를 근거로 쓰는지(지표 수집 방법)</strong>
              </span>
              <span>
                <strong>② 그 지표를 어떤 논리로 해석해 결론에 도달하는지(사고 과정)</strong>
              </span>
              <span>
                <strong>③ 결론을 어떤 형식·어조로 전달하는지(보고 방식)</strong>
              </span>
              <span>이 학습 노트는 매일의 리포트를 서술하는 프롬프트에 참고자료로 함께 들어갑니다.</span>
              <span>이 페이지는 세 단계(수집 · 증류 · 적용)가 실제로 어디까지 진행됐고, 무엇이 부족한지를 있는 그대로 보여줍니다.</span>
            </p>
          </div>
        </div>

        <div className={styles.stageGrid}>
          <div className={styles.stageCard}>
            <div className={styles.stageHead}>
              <span className={styles.stageNum}>①</span>
              <span className={styles.stageName}>수집</span>
              <span className={`${styles.statusDot} ${collecting ? styles.on : styles.off}`} style={{ marginLeft: "auto" }} />
            </div>
            <span className={styles.stageMetric}>{totalCollected.toLocaleString("ko-KR")}건</span>
            <span className={styles.stageMetricLabel}>누적 수집 자료</span>
            <p className={styles.stageNote}>
              {collectionBySource.length}개 소스 · {fmtDate(firstCollected?.createdAt)}부터 축적
            </p>
          </div>

          <div className={styles.stageCard}>
            <div className={styles.stageHead}>
              <span className={styles.stageNum}>②</span>
              <span className={styles.stageName}>증류(자가학습)</span>
              <span className={`${styles.statusDot} ${distilling ? styles.on : styles.off}`} style={{ marginLeft: "auto" }} />
            </div>
            <span className={styles.stageMetric}>{totalNotes.toLocaleString("ko-KR")}건</span>
            <span className={styles.stageMetricLabel}>축적된 학습 노트</span>
            <p className={styles.stageNote}>
              {notesByCategory.length}개 분류 · 최근 생성 {fmtDateTime(latestNote?.createdAt)}
            </p>
          </div>

          <div className={styles.stageCard}>
            <div className={styles.stageHead}>
              <span className={styles.stageNum}>③</span>
              <span className={styles.stageName}>적용</span>
              <span className={`${styles.statusDot} ${distilling ? styles.on : styles.off}`} style={{ marginLeft: "auto" }} />
            </div>
            <span className={styles.stageMetric}>{distilling ? "최근 5건" : "0건"}</span>
            <span className={styles.stageMetricLabel}>리포트 프롬프트에 주입되는 학습 노트</span>
            <p className={styles.stageNote}>
              {distilling
                ? "다음 정기 리포트부터 반영 — 실제 문장 반영 여부는 아직 라이브 확인 전"
                : "학습 노트가 없어 아직 반영할 내용이 없습니다"}
            </p>
          </div>
        </div>

        <h2 className={styles.sectionHeading}>① 수집 — 소스별 현황</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>소스</th>
                <th>누적 건수</th>
                <th>최근 수집일</th>
              </tr>
            </thead>
            <tbody>
              {collectionBySource.length === 0 ? (
                <tr>
                  <td colSpan={3}>아직 수집된 자료가 없습니다.</td>
                </tr>
              ) : (
                collectionBySource
                  .sort((a, b) => b._count._all - a._count._all)
                  .map((row) => (
                    <tr key={row.sourceType}>
                      <td>{SOURCE_TYPE_LABEL[row.sourceType] ?? row.sourceType}</td>
                      <td>{row._count._all.toLocaleString("ko-KR")}건</td>
                      <td>{fmtDate(row._max.date)}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>

        <h2 className={styles.sectionHeading}>② 증류 — 분류별 현황</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>분류</th>
                <th>학습 노트</th>
                <th>최근 생성</th>
              </tr>
            </thead>
            <tbody>
              {notesByCategory.length === 0 ? (
                <tr>
                  <td colSpan={3}>아직 생성된 학습 노트가 없습니다.</td>
                </tr>
              ) : (
                notesByCategory
                  .sort((a, b) => b._count._all - a._count._all)
                  .map((row) => (
                    <tr key={row.category}>
                      <td>{row.category}</td>
                      <td>{row._count._all.toLocaleString("ko-KR")}건</td>
                      <td>{fmtDateTime(row._max.createdAt)}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>

        {latestNote && (
          <div className={styles.noteSample}>
            <div className={styles.noteSampleHead}>
              <span>
                최근 학습 노트 표본 — {latestNote.category} / {latestNote.sourceName}
              </span>
              <span>{fmtDateTime(latestNote.createdAt)}</span>
            </div>
            <p className={styles.noteSampleBody}>{latestNote.summary}</p>
          </div>
        )}

        <h2 className={styles.sectionHeading}>부족한 점 · 필요한 점</h2>
        <div className={styles.gapList}>
          <div className={styles.gapItem}>
            <span className={styles.gapIcon}>!</span>
            <div className={styles.gapText}>
              <h3>기관 6곳 추가 조사 보류 중</h3>
              <p>
                BIS(스크래퍼 미검증) · 한국은행(카테고리 필터링 미해결) · 자본시장연구원(봇 차단+Cloudflare Turnstile) ·
                JPMorgan Asset Management(JS 렌더링) · 미래에셋증권(목록 페이지 렌더링 미확인) · IMF(403 차단) — &ldquo;확실한
                기관 먼저&rdquo; 원칙에 따라 뒤로 미뤄둔 상태입니다.
              </p>
            </div>
          </div>
          <div className={styles.gapItem}>
            <span className={styles.gapIcon}>!</span>
            <div className={styles.gapText}>
              <h3>2025년 11월~현재 과거 자료 백필 미착수</h3>
              <p>날짜 범위 지정 수집이 확인된 곳은 SEC EDGAR·World Bank뿐이고, 나머지 소스는 아직 &ldquo;최신 자료&rdquo;만 수집합니다.</p>
            </div>
          </div>
          <div className={styles.gapItem}>
            <span className={styles.gapIcon}>!</span>
            <div className={styles.gapText}>
              <h3>③ 적용, 실제 리포트에서 아직 확인 전</h3>
              <p>
                프롬프트에 학습 노트를 넣는 코드는 연결돼 있지만, 그 내용이 실제 리포트 문장에 반영되는 모습은 아직 라이브로
                확인하지 않았습니다.
              </p>
            </div>
          </div>
          {duplicateNoteRows > 0 && (
            <div className={styles.gapItem}>
              <span className={styles.gapIcon}>!</span>
              <div className={styles.gapText}>
                <h3>중복 학습 노트 {duplicateNoteRows}건</h3>
                <p>
                  같은 출처를 여러 번 증류하며 생긴 중복입니다. 리포트에는 최신 5건만 쓰여 기능상 문제는 없지만, 데이터 정리가
                  필요합니다.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
