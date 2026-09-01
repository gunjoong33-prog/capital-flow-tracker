import { db } from "@/lib/db";
import { SiteHeader } from "@/components/SiteHeader";
import { ibmPlexMono, mrsSaintDelafield } from "@/lib/site-fonts";
import siteStyles from "@/styles/site.module.css";
import styles from "./page.module.css";

export const dynamic = "force-dynamic"; // 자가진단이 매일 새 로그를 쌓으므로 항상 최신 조회

export const metadata = {
  title: "수정과정 · 자본 흐름 체크리스트",
};

function StatusCard({ label, value, on, context }: { label: string; value: string; on: boolean; context: string }) {
  return (
    <div className={styles.statusCard}>
      <div className={styles.statusLabel}>{label}</div>
      <div className={styles.statusValue}>
        <span className={`${styles.statusDot} ${on ? styles.on : styles.off}`} />
        {value}
      </div>
      <div className={styles.statusContext}>{context}</div>
    </div>
  );
}

function badgeClass(good: boolean | null): string {
  if (good === null) return `${styles.badge} ${styles.badgeNeutral}`;
  return good ? `${styles.badge} ${styles.badgeGood}` : `${styles.badge} ${styles.badgeBad}`;
}

export default async function CorrectionProcessPage() {
  const logs = await db.autoFixLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const autoFixEnabled = process.env.AUTO_FIX_ENABLED === "true";
  const asOfLabel = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className={`${siteStyles.page} ${ibmPlexMono.variable} ${mrsSaintDelafield.variable}`}>
      <SiteHeader current="correction-process" />
      <div className={siteStyles.wrap} style={{ paddingTop: "1.5rem", paddingBottom: "3rem" }}>
        <h1 className={styles.title}>수정과정</h1>

        <div className={styles.explainer}>
          <div className={styles.explainerRow}>
            <span className={styles.explainerTag}>작동 방식</span>
            <p className={styles.explainerText}>
              <span>매일 자가진단 파이프라인이 최근 예측 결과에서 이상 패턴(연속 오적중 등)이 있는지 점검합니다.</span>
              <span>
                이상이 발견되면 GitHub Actions에서 Claude Code가 헤드리스로 원인을 진단하고 수정을
                시도합니다 — 테스트를 통과하고 채점 로직 등 보호 파일을 건드리지 않았을 때만
                자동으로 master에 배포되고, 그렇지 않으면 사람이 검토할 초안 PR만 만들어집니다.
              </span>
              <span>이 페이지는 그 시도 이력을 성공·실패 구분 없이 전부 기록합니다.</span>
            </p>
          </div>
        </div>

        <div className={styles.statusRow}>
          <StatusCard
            label="자동배포"
            value={autoFixEnabled ? "켜짐" : "꺼짐(안전장치)"}
            on={autoFixEnabled}
            context={
              autoFixEnabled
                ? "이상 발견 시 테스트 통과하면 자동으로 master에 배포됩니다."
                : "자가진단은 매일 돌지만, 이상을 발견해도 자동 배포는 하지 않고 알림만 보냅니다. 오탐 빈도를 먼저 확인한 뒤 켤 예정입니다."
            }
          />
          <StatusCard
            label="기록된 수정 시도"
            value={`${logs.length}건`}
            on={logs.length > 0}
            context={`기준 시각 ${asOfLabel} KST`}
          />
        </div>

        {logs.length === 0 ? (
          <div className={styles.empty}>
            <span>아직 기록된 수정 시도가 없습니다.</span>
            <span>자가진단은 매일 09:45(KST) 정상적으로 실행되고 있지만, 자동배포가 꺼져 있어(위 상태 참고) 이상이 발견돼도 이 로그에는 남지 않고 Discord 알림으로만 전달됩니다.</span>
            <span>자동배포를 켜면 그때부터 이 페이지에 실제 진단·수정 이력이 쌓입니다.</span>
          </div>
        ) : (
          <div className={styles.timeline}>
            {logs.map((log) => (
              <div key={log.id} className={styles.logCard}>
                <div className={styles.logHead}>
                  <span className={styles.logDate}>
                    {log.createdAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </div>
                <p className={styles.logIssue}>{log.detectedIssue}</p>
                {log.attemptedFix && <p className={styles.logFix}>{log.attemptedFix}</p>}
                <div className={styles.badgeRow}>
                  <span className={badgeClass(log.testsPassed)}>
                    테스트 {log.testsPassed === null ? "대기" : log.testsPassed ? "통과" : "실패"}
                  </span>
                  <span className={badgeClass(log.protectedFileTouched === null ? null : !log.protectedFileTouched)}>
                    보호 파일 {log.protectedFileTouched === null ? "확인 대기" : log.protectedFileTouched ? "건드림" : "안 건드림"}
                  </span>
                  <span className={badgeClass(log.deployed)}>{log.deployed ? "자동 배포됨" : "배포 안 됨"}</span>
                </div>
                {log.prUrl && (
                  <p className={styles.prLink}>
                    <a href={log.prUrl} target="_blank" rel="noopener noreferrer">
                      PR 보기 →
                    </a>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
