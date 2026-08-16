import Link from "next/link";
import styles from "@/components/ReportView.module.css";
import { StepCard, Field } from "@/components/StepCard";
import { ScoreBadge, DecisionBadge } from "@/components/ScoreBadge";
import { RiskyNewsList } from "@/components/RiskyNewsList";
import {
  Step2Donut, Step3ThresholdBar, Step4Quadrant, Step6SectorBars, Step7Gauge, Step8ContributionBar,
  GRAPH_COLOR_PURPLE, GRAPH_COLOR_AMBER,
} from "@/components/StepGraphs";
import { STEP_TIPS } from "@/lib/scoring/tips";
import { decisionFromScore, WEIGHTS } from "@/lib/scoring/pure";
import { slashDate } from "@/lib/text-format";
import type {
  Step1Result, Step2Result, Step3Result, Step4Result,
  Step5Result, Step6Result, Step7Result, Step8Result,
  StepDetails, StepDetailRow,
} from "@/lib/scoring/types";

/** 그래프용 숫자는 새로 계산하지 않고 이미 화면에 쓰이는 details 표시값에서만 뽑는다
 * (run.ts가 만든 값과 절대 어긋나지 않게 하기 위함 — backfill-ppt-slides.ts와 같은 원칙). */
function leadingNumber(value: string): number | null {
  const m = value.match(/^(-?\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
}
function fiveDayReturn(value: string): number | null {
  const m = value.match(/5일\s*(-?\d+\.?\d*)%/);
  return m ? parseFloat(m[1]) : null;
}
function sectorReturnsFromDetails(rows: StepDetailRow[] | undefined): { name: string; return5d: number }[] {
  if (!rows) return [];
  return rows
    .map((r) => ({ name: r.label, return5d: fiveDayReturn(r.value) }))
    .filter((s): s is { name: string; return5d: number } => s.return5d !== null);
}

export const STEP_TAB_TITLES = ["글로벌환경", "유동성", "캐리트레이드", "환율·금·유가", "자금도착", "섹터", "심리필터", "최종결론"];

export interface ReportViewData {
  step1: Step1Result;
  step2: Step2Result;
  step3: Step3Result;
  step4: Step4Result;
  step5: Step5Result;
  step6: Step6Result;
  step7: Step7Result;
  step8: Step8Result;
}

export function ReportView({
  dateLabel,
  report,
  details,
}: {
  dateLabel: string;
  report: ReportViewData;
  details?: StepDetails | null;
}) {
  const { step1, step2, step3, step4, step5, step6, step7, step8 } = report;
  // 거부권이 실제로 결론을 바꿨는지 원점수 기준 결론과 비교해서 보여준다 — 이미 최하단(현금비중늘리기)
  // 이던 날은 거부권이 발동돼도 결론이 그대로라, 예전처럼 항상 "한 단계 하향 조정됨"이라고만 쓰면
  // 실제로는 아무 영향이 없었던 날도 결론이 바뀐 것처럼 보인다(외부 감사 지적, 실제 확인).
  const preVetoDecision = decisionFromScore(step8.macroTrendScore);
  const vetoChangedDecision = step8.vetoApplied && preVetoDecision !== step8.finalDecision;

  // 그래프용 값 — 전부 details 표시값에서 파싱(위 helper 참고), 새 계산 없음.
  const vixRow = details?.step7?.find((r) => r.label === "VIX");
  const fgRow = details?.step7?.find((r) => r.label === "CNN 공포와 탐욕지수");
  const vixValue = vixRow && vixRow.value !== "확인 못함" ? leadingNumber(vixRow.value) : null;
  const fearGreedValue = fgRow && fgRow.value !== "확인 못함" ? leadingNumber(fgRow.value) : null;
  const sectorReturns = sectorReturnsFromDetails(details?.step6);
  const step8Contributions = [
    { label: `유동성×${WEIGHTS.step2}`, weighted: step2.finalScore * WEIGHTS.step2, color: "var(--accent)" },
    { label: `캐리×${WEIGHTS.step3}`, weighted: step3.score * WEIGHTS.step3, color: GRAPH_COLOR_PURPLE },
    { label: `환율금유가×${WEIGHTS.step4}`, weighted: step4.score * WEIGHTS.step4, color: "var(--pos)" },
    { label: `자금도착×${WEIGHTS.step5}`, weighted: step5.score * WEIGHTS.step5, color: GRAPH_COLOR_AMBER },
    { label: `섹터×${WEIGHTS.step6}`, weighted: step6.score * WEIGHTS.step6, color: "var(--ink-faint)" },
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="text-sm text-[var(--ink-faint)]">{dateLabel} · 자본 흐름 체크리스트</p>
        <div className="flex flex-wrap items-center gap-3">
          <DecisionBadge decision={step8.finalDecision} />
          <ScoreBadge score={step8.macroTrendScore} label="투자 적합도 점수" />
          {step8.positionSizePct !== null && (
            <span className="text-sm text-[var(--ink-dim)]">권장 매수 비중 {step8.positionSizePct}%</span>
          )}
          {/* cashAllocationPct는 이 필드가 없는 과거 저장 리포트(JSON 컬럼)에선 undefined로 온다 —
              null이 아니라 undefined라 !== null만으로는 안 걸러져 typeof로 명시 체크한다. */}
          {typeof step8.cashAllocationPct === "number" && (
            <span className="text-sm text-[var(--ink-dim)]">참고 현금 비중 {step8.cashAllocationPct}%</span>
          )}
        </div>
        {/* 배지(rounded-full 알약 모양)는 상태 단문에만 쓴다 — 거부권 설명은 완전한 문장이라
            배지가 아니라 아래 트랙레코드 안내와 같은 캡션 스타일로 통일한다(디자인 일관성 정리). */}
        {step8.vetoApplied && (
          <p className="[word-break:keep-all] text-xs text-[var(--neg)]">
            ⚠ {vetoChangedDecision
              ? `1단계 거부권 발동 — 결론이 "${preVetoDecision}"에서 "${step8.finalDecision}"로 하향 조정됨`
              : `1단계 거부권 발동 — 원점수 기준으로도 이미 "${step8.finalDecision}"라 결론 변화 없음`}
          </p>
        )}
        {/* 결론 배지 바로 옆에 상시 노출 — 아직 표본이 적어(2026-07-27부터 운영 시작) "매수/지켜보기/
            현금비중늘리기" 결론이 실제로 얼마나 맞았는지 추적한 트랙레코드가 없다는 걸 명시한다.
            사용자가 결론만 보고 투자 신호처럼 쓰지 않도록 하는 게 목적(외부 감사 지적, 실제로 백테스트
            페이지가 없는 것도 확인). 나중에 트랙레코드 페이지가 생기면 이 문구를 그 페이지 링크로
            바꾸거나 조건부로(표본이 쌓이면) 없앤다. */}
        <p className="[word-break:keep-all] text-xs text-[var(--ink-faint)]">
          ⚠ 이 결론의 과거 적중률은{" "}
          <Link href="/track-record" className="underline">
            여기서 확인
          </Link>
          할 수 있습니다(2026년 7월 27일부터 운영 시작, 표본 아직 적음) — 투자 신호가 아니라 참고
          자료로만 활용하세요.
        </p>
      </header>

      {details?.comprehensiveReport && (
        <div>
          <input type="checkbox" id="comprehensive-report-toggle" className="peer hidden" />
          <label
            htmlFor="comprehensive-report-toggle"
            className="flex cursor-pointer select-none items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] px-4 py-3 text-sm font-medium text-[var(--ink)] hover:border-[var(--accent-strong)] peer-checked:hidden"
          >
            종합 보고서 보기
          </label>
          <label
            htmlFor="comprehensive-report-toggle"
            className="hidden cursor-pointer select-none items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] px-4 py-3 text-sm font-medium text-[var(--ink)] hover:border-[var(--accent-strong)] peer-checked:flex"
          >
            종합 보고서 접기
          </label>
          <div className="mt-3 hidden whitespace-pre-line [word-break:keep-all] rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] p-5 text-sm leading-relaxed text-[var(--ink-dim)] peer-checked:block">
            {details.comprehensiveReport}
          </div>
        </div>
      )}

      {/* 8개 라디오는 전부 여기 모아둔다 — 아래 탭 nav·패널 어디서든 peer-checked/tN:으로
          같은 이름의 peer를 참조할 수 있게 하려면 이 입력들이 참조하는 요소들보다 DOM상
          앞에 있어야 한다(일반 형제 결합자 특성). */}
      <input type="radio" name="step-tab" id="step-tab-1" defaultChecked className="peer/t1 hidden" />
      <input type="radio" name="step-tab" id="step-tab-2" className="peer/t2 hidden" />
      <input type="radio" name="step-tab" id="step-tab-3" className="peer/t3 hidden" />
      <input type="radio" name="step-tab" id="step-tab-4" className="peer/t4 hidden" />
      <input type="radio" name="step-tab" id="step-tab-5" className="peer/t5 hidden" />
      <input type="radio" name="step-tab" id="step-tab-6" className="peer/t6 hidden" />
      <input type="radio" name="step-tab" id="step-tab-7" className="peer/t7 hidden" />
      <input type="radio" name="step-tab" id="step-tab-8" className="peer/t8 hidden" />

      {/* "선택됨" 강조는 ReportView.module.css의 형제+자손 결합자 체이닝으로 처리한다(Tailwind의
          peer-checked/name:는 라디오의 "진짜 형제"만 잡는데, 이 라벨들은 <nav> 자손이라 안 먹힌다 —
          styles.tabN이라는 고정 클래스명만 붙이면 되므로 여기는 데이터 기반 map으로 반복 없이 쓴다. */}
      <nav className="flex justify-between gap-1.5 overflow-x-auto pb-1">
        {STEP_TAB_TITLES.map((title, i) => {
          const n = i + 1;
          return (
            <label
              key={n}
              htmlFor={`step-tab-${n}`}
              className={`${styles[`tab${n}`]} flex min-w-[4.2rem] shrink-0 cursor-pointer select-none flex-col items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] px-2 py-2.5 text-[var(--ink-faint)] hover:border-[var(--accent-strong)] hover:text-[var(--ink-dim)]`}
            >
              <span className={`${styles.num} flex h-6 w-6 items-center justify-center rounded-full bg-[var(--border)] text-xs font-bold text-[var(--ink-dim)]`}>
                {n}
              </span>
              <span className="whitespace-nowrap text-[10px]">{title}</span>
            </label>
          );
        })}
      </nav>

      {/* peer-checked/tN: 은 일반 형제 결합자(~)라서 패널이 라디오와 실제 형제(같은 부모의
          자식)여야 동작한다 — 감싸는 래퍼 div 안에 넣으면 형제 관계가 끊겨 전부 숨겨진 채로
          고정된다(실제 겪은 버그, 화면에 아무 단계도 안 뜨던 것 — 그래서 Fragment로 감싼다). */}
      <>
        <div className="hidden peer-checked/t1:block">
          <StepCard step={1} title="글로벌 환경" details={details?.step1} tip={STEP_TIPS[1]}>
            <Field label="거부권 발동" value={step1.vetoTriggered ? "예" : "아니오"} />
            <Field label="사유" value={step1.reason} />
            {step1.riskyNews && step1.riskyNews.length > 0 && <RiskyNewsList riskyNews={step1.riskyNews} />}
            {step1.recentEventOutcomes && step1.recentEventOutcomes.filter((o) => o.risky).length > 0 && (
              <div className="mt-3 space-y-2">
                {step1.recentEventOutcomes.filter((o) => o.risky).map((o, i) => (
                  <div key={i} className="[word-break:keep-all] rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    {o.name}({slashDate(o.date)}) 결과가 예상 밖입니다 — {o.detail}
                    {o.url && (
                      <a href={o.url} target="_blank" rel="noopener noreferrer" className="mt-1 block underline text-rose-400 hover:text-rose-300">
                        자세히 보기 →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
            {step1.upcomingEvents && step1.upcomingEvents.length > 0 && (
              <p className="mt-2 text-xs text-[var(--ink-faint)]">
                14일 내 예정된 이벤트: {step1.upcomingEvents.map((e) => `${e.name}(${slashDate(e.date)})`).join(", ")}
              </p>
            )}
          </StepCard>
        </div>

        <div className="hidden peer-checked/t2:block">
          <StepCard step={2} title="자본의 유동성" score={step2.finalScore} details={details?.step2} auxDetails={details?.step2Aux} tip={STEP_TIPS[2]} summary={details?.step2Summary}>
            <Field label="해외 지표 충족" value={`${step2.overseasQualifyingCount} / ${step2.overseasTotalCount}`} />
            <p className="mt-2 mb-1.5 text-xs text-[var(--ink-faint)]">
              Fed 대차대조표·M2 통화량·기준잔액·역레포·TGA·실질금리·크레딧 스프레드 7개 지표 중 &quot;유동성 우호적&quot; 방향으로
              움직인 게 몇 개인지 센 값이다(역레포가 고갈 상태면 판정을 무효화해 분모에서 빠지므로 분모가 6으로
              보일 수 있다 — 아래 상세 보기에서 지표별 충족 여부 확인 가능). 이 비율이 2단계 점수의 기반이 된다.
            </p>
            <Step2Donut qualifying={step2.overseasQualifyingCount} total={step2.overseasTotalCount} />
          </StepCard>
        </div>

        <div className="hidden peer-checked/t3:block">
          <StepCard step={3} title="캐리 트레이드" score={step3.score} details={details?.step3} tip={STEP_TIPS[3]} summary={details?.step3Summary}>
            <Field label="US10Y-JP10Y 스프레드" value={`${step3.spreadBp}bp`} />
            <Field label="구간(참고용, 미검증)" value={step3.zone} />
            {step3.warning && (
              <p className="mt-2 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{step3.warning}</p>
            )}
            <Step3ThresholdBar spreadBp={step3.spreadBp} />
          </StepCard>
        </div>

        <div className="hidden peer-checked/t4:block">
          <StepCard step={4} title="환율·금·유가" score={step4.score} details={details?.step4} auxDetails={details?.step4Aux} tip={STEP_TIPS[4]} summary={details?.step4Summary}>
            <Field label="사분면" value={step4.quadrant} />
            <Field label="달러 확인" value={step4.dollarConfirms ? "실질금리와 동행(신호 강함)" : "디커플링(경계)"} />
            <Step4Quadrant quadrant={step4.quadrant} />
          </StepCard>
        </div>

        <div className="hidden peer-checked/t5:block">
          <StepCard
            step={5}
            title="규모별·성격별 자금 도착"
            score={step5.score}
            details={details?.step5}
            auxDetails={details?.step5Aux}
            auxHideMetColumn
            auxLabel="지수·크립토 마감 시세"
            aux2Details={details?.step5BigTech}
            aux2HideMetColumn
            aux2Label="빅테크 7 마감 시세"
            tip={STEP_TIPS[5]}
            summary={details?.step5Summary}
          >
            <Field label="나스닥-러셀 격차" value={`${step5.gapPp.toFixed(2)}%p`} />
            <Field label="쏠림 경계" value={step5.concentrationWarning ? "예" : "아니오"} />
            <Field label="위험선호" value={step5.riskAppetite} />
            {step5.cryptoAlignsWithRisk !== null && (
              <Field label="암호화폐 동조" value={step5.cryptoAlignsWithRisk ? "나스닥과 같은 방향" : "괴리(고유 이슈 가능)"} />
            )}
          </StepCard>
        </div>

        <div className="hidden peer-checked/t6:block">
          <StepCard step={6} title="자본의 최종 목적지(섹터, 사후 확인용)" score={step6.score} details={details?.step6} detailsWideCriterion tip={STEP_TIPS[6]} summary={details?.step6Summary}>
            <Field label="충족 섹터" value={step6.qualifying.length > 0 ? step6.qualifying.join(", ") : "없음"} />
            <Step6SectorBars sectors={sectorReturns} />
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="https://finviz.com/map.ashx"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--ink-dim)] hover:border-[var(--accent-strong)] hover:text-[var(--ink)]"
              >
                S&P500 히트맵(Finviz) →
              </a>
              <a
                href="https://www.trendforce.com"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--ink-dim)] hover:border-[var(--accent-strong)] hover:text-[var(--ink)]"
              >
                산업 트렌드(TrendForce) →
              </a>
            </div>
          </StepCard>
        </div>

        <div className="hidden peer-checked/t7:block">
          <StepCard
            step={7}
            title="심리 필터(합산 제외, 포지션 크기 조절용)"
            auxDetails={details?.step7Institutional}
            auxHideMetColumn
            auxNarrowCriterion
            auxLabel="기관·내부자 매집 지표"
            aux2Details={details?.step7}
            aux2Label="공포와 탐욕 지수"
            tip={STEP_TIPS[7]}
            summary={details?.step7Summary}
          >
            <Field label="양쪽 과열" value={step7.bothOverheated ? "예 — 매수 크기 30% 축소" : "아니오"} />
            <Field label="극단적 공포/VIX 급등" value={step7.fearZone ? "예 — 역발상 기회 고려" : "아니오"} />
            <Step7Gauge vix={vixValue} fearGreed={fearGreedValue} />
          </StepCard>
        </div>

        {details?.step8 && details.step8.length > 0 && (
          <div className="hidden peer-checked/t8:block">
            <StepCard step={8} title="최종 결론 계산" details={details.step8} detailsHideMetColumn tip={STEP_TIPS[8]}>
              <Field label="투자 적합도 점수" value={step8.macroTrendScore.toFixed(2)} />
              <Field label="최종 결론" value={step8.finalDecision} />
              <Step8ContributionBar contributions={step8Contributions} />
            </StepCard>
          </div>
        )}
      </>

      <p className="pt-4 text-center text-xs text-[var(--ink-faint)]">
        이 체크리스트는 검증된 필승 투자법이 아니라 조사를 도와주는 도구다. 투자 손실은 본인 책임이다.
      </p>
    </div>
  );
}
