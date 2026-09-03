import Link from "next/link";
import { db } from "@/lib/db";
import { SiteHeader } from "@/components/SiteHeader";
import { ibmPlexMono, mrsSaintDelafield } from "@/lib/site-fonts";
import siteStyles from "@/styles/site.module.css";
import styles from "../page.module.css";
import { InstitutionNotes } from "./InstitutionNotes";

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

// ExternalConsensus.payload는 소스별 fetcher가 만든 CollectedItem을 그대로 저장한 것 —
// url·title 필드가 있다(institutional-research.ts:31-37). 13F 등 예전 소스는 이 모양이 아닐 수
// 있어 옵셔널로 읽는다.
type PayloadLink = { url?: string; title?: string };

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
  const weeklySynthesis = await db.weeklyLearningSynthesis.findFirst({ orderBy: { createdAt: "desc" } });

  // 기관별 버튼으로 걸러볼 "최근 학습 노트"는 최신 1건이 속한 주(periodKey) 전체를 보여준다 —
  // "최근 8건" 같은 임의 개수 컷은 노트가 많은 기관(예: 미래에셋 10건)이 적은 기관을 밀어내
  // 버튼을 눌러도 그 기관 노트가 하나도 안 보일 수 있었다(periodKey는 sourceName당 주 1건
  // upsert라 "이번 주 생성분 전체"가 곧 "최근"과 같은 뜻이다 — learning-distill.ts 참고).
  const recentNotes = latestNote
    ? await db.learningNote.findMany({ where: { periodKey: latestNote.periodKey }, orderBy: { createdAt: "desc" } })
    : [];

  // 수집 테이블에 "최근 자료" 링크를 붙이기 위해 소스별로 가장 최근 항목 하나씩만 조회 —
  // 소스 개수(현재 12개)만큼만 도는 작은 쿼리라 N+1이어도 부담 없다.
  const latestBySourceType = new Map<string, PayloadLink>();
  await Promise.all(
    collectionBySource.map(async (row) => {
      const latest = await db.externalConsensus.findFirst({
        where: { sourceType: row.sourceType },
        orderBy: { createdAt: "desc" },
        select: { payload: true },
      });
      if (latest) latestBySourceType.set(row.sourceType, latest.payload as unknown as PayloadLink);
    })
  );

  // 최근 학습 노트 각각이 어떤 원문(들)에서 나왔는지 — basedOn(ExternalConsensus id 배열)을
  // 한 번에 조회해 노트별로 대표 링크와 "기관"(sourceType→SOURCE_TYPE_LABEL)을 붙인다.
  const allBasedOnIds = [...new Set(recentNotes.flatMap((n) => (n.basedOn as unknown as string[]) ?? []))];
  const basedOnRows =
    allBasedOnIds.length > 0
      ? await db.externalConsensus.findMany({
          where: { id: { in: allBasedOnIds } },
          select: { id: true, sourceType: true, payload: true },
        })
      : [];
  const basedOnById = new Map(basedOnRows.map((r) => [r.id, r]));
  function noteSourceInfo(note: (typeof recentNotes)[number]): { link?: PayloadLink; institution: string } {
    const ids = (note.basedOn as unknown as string[]) ?? [];
    for (const id of ids) {
      const row = basedOnById.get(id);
      if (!row) continue;
      const payload = row.payload as unknown as PayloadLink;
      return { link: payload?.url ? payload : undefined, institution: SOURCE_TYPE_LABEL[row.sourceType] ?? row.sourceType };
    }
    return { institution: "기타" };
  }

  const notesForFilter = recentNotes.map((note) => {
    const { link, institution } = noteSourceInfo(note);
    return {
      id: note.id,
      category: note.category,
      institution,
      summary: note.summary,
      createdAt: note.createdAt,
      sourceUrl: link?.url,
      sourceTitle: link?.title,
    };
  });

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
              <span>모은 자료를 LLM으로 다시 읽혀, 각 기관의 다음 네 가지를 학습 노트로 남깁니다.</span>
              <span>
                <strong>① 어떤 지표를 근거로 쓰는지(지표 수집 방법)</strong>
              </span>
              <span>
                <strong>② 그 지표를 어떤 논리로 해석해 결론에 도달하는지(사고 과정)</strong>
              </span>
              <span>
                <strong>③ 결론을 어떤 형식·어조로 전달하는지(보고 방식)</strong>
              </span>
              <span>
                <strong>④ 실제로 어떤 주제·수치·전망을 다뤘는지(배경지식)</strong>
              </span>
              <span>
                이 학습 노트들은 매주 한 번 LLM으로 하나의 &ldquo;이번 주 학습 요약&rdquo;으로 압축되고, 매일의 리포트를
                서술하는 프롬프트에는 원문 노트가 아니라 이 압축본 1건이 참고자료로 함께 들어갑니다.
              </span>
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
              <span className={`${styles.statusDot} ${weeklySynthesis ? styles.on : styles.off}`} style={{ marginLeft: "auto" }} />
            </div>
            <span className={styles.stageMetric}>{weeklySynthesis ? "압축본 1건" : "0건"}</span>
            <span className={styles.stageMetricLabel}>리포트 프롬프트에 주입되는 주간 학습 요약</span>
            <p className={styles.stageNote}>
              {weeklySynthesis
                ? `매 리포트 생성마다 이번 주(${weeklySynthesis.periodKey}) 압축본이 실제로 프롬프트에 주입됨(코드 확인) — 문장에 얼마나 반영됐는지는 미측정`
                : "아직 생성된 주간 압축본이 없어 반영할 내용이 없습니다"}
            </p>
          </div>
        </div>

        {weeklySynthesis && (
          <>
            <h2 className={styles.sectionHeading}>이번 주 학습 요약 — 매일 리포트에 실제로 주입됨</h2>
            <div className={styles.noteSample}>
              <div className={styles.noteSampleHead}>
                <span>periodKey: {weeklySynthesis.periodKey}</span>
                <span>{fmtDateTime(weeklySynthesis.createdAt)}</span>
              </div>
              <p className={styles.noteSampleBody}>{weeklySynthesis.content}</p>
            </div>
          </>
        )}

        <h2 className={styles.sectionHeading}>① 수집 — 소스별 현황</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>소스</th>
                <th>누적 건수</th>
                <th>최근 수집일</th>
                <th>최근 자료</th>
              </tr>
            </thead>
            <tbody>
              {collectionBySource.length === 0 ? (
                <tr>
                  <td colSpan={4}>아직 수집된 자료가 없습니다.</td>
                </tr>
              ) : (
                collectionBySource
                  .sort((a, b) => b._count._all - a._count._all)
                  .map((row) => {
                    const latest = latestBySourceType.get(row.sourceType);
                    return (
                      <tr key={row.sourceType}>
                        <td>{SOURCE_TYPE_LABEL[row.sourceType] ?? row.sourceType}</td>
                        <td>{row._count._all.toLocaleString("ko-KR")}건</td>
                        <td>{fmtDate(row._max.date)}</td>
                        <td className={styles.sourceLinkCell}>
                          {latest?.url ? (
                            <a href={latest.url} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>
                              {latest.title || latest.url}
                            </a>
                          ) : (
                            <span className={styles.sourceLinkMissing}>출처 링크 없음</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
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

        {notesForFilter.length > 0 && (
          <>
            <h2 className={styles.sectionHeading}>최근 학습 노트 — 기관별로 보기</h2>
            <InstitutionNotes notes={notesForFilter} />
          </>
        )}

        <h2 className={styles.sectionHeading}>부족한 점 · 필요한 점</h2>
        <div className={styles.gapList}>
          <div className={styles.gapItem}>
            <span className={styles.gapIcon}>!</span>
            <div className={styles.gapText}>
              <h3>IMF 한 곳만 미연동</h3>
              <p>
                2026-09-02 재조사로 BIS Quarterly Review·한국은행·자본시장연구원·JPMorgan Asset Management·미래에셋증권 5곳은
                실제로 접근 가능함이 확인돼 연동을 완료했습니다. IMF만 유일한 우회 경로(elibrary.imf.org의 journalCode 확인
                페이지)가 robots.txt로 막혀 있어 원칙대로 미구현 상태입니다.
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
              <h3>③ 적용 — 코드 실행은 확인, 문장 반영 정도는 미측정</h3>
              <p>
                <code>generateNarrative()</code>가 일일 리포트·종합 보고서·주기별 리포트 등 서술을 생성하는 모든 호출마다 예외
                없이 이번 주 학습 노트를 압축한 주간 요약 1건을 프롬프트에 참고자료로 붙인다는 것은 코드로 확인했습니다. 다만
                LLM이 그 참고자료를 실제로 얼마나 반영해 문장을 바꾸는지는 정량적으로 측정하지 않았습니다(A/B 비교 등 검증
                인프라 없음).
              </p>
            </div>
          </div>
          {duplicateNoteRows > 0 && (
            <div className={styles.gapItem}>
              <span className={styles.gapIcon}>!</span>
              <div className={styles.gapText}>
                <h3>중복 학습 노트 {duplicateNoteRows}건</h3>
                <p>
                  같은 출처를 여러 번 증류하며 생긴 중복입니다. 이제는 개별 노트가 리포트에 직접 쓰이지 않고 매주 한 번
                  압축될 뿐이라 중복 자체가 압축 결과를 왜곡할 위험은 낮지만(같은 내용이 한 번 더 들어가는 정도), 압축
                  단계의 입력을 불필요하게 늘리는 셈이라 데이터 정리는 여전히 필요합니다.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
