import { StepCard, Field } from "@/components/StepCard";
import { ScoreBadge, DecisionBadge } from "@/components/ScoreBadge";
import { RiskyNewsList } from "@/components/RiskyNewsList";
import { STEP_TIPS } from "@/lib/scoring/tips";
import { decisionFromScore } from "@/lib/scoring/pure";
import type {
  Step1Result, Step2Result, Step3Result, Step4Result,
  Step5Result, Step6Result, Step7Result, Step8Result,
  StepDetails,
} from "@/lib/scoring/types";

/** "YYYY-MM-DD" → "YYYY/M/D"(선행 0 없이). run.ts의 slashDate와 같은 표기 규칙(1단계 표시용). */
function slashDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}/${m}/${d}`;
}

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

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="text-sm text-[var(--ink-faint)]">{dateLabel} · 자본 흐름 체크리스트</p>
        <div className="flex flex-wrap items-center gap-3">
          <DecisionBadge decision={step8.finalDecision} />
          <ScoreBadge score={step8.macroTrendScore} label="투자 적합도 점수" />
          {step8.vetoApplied && (
            <span className="[word-break:keep-all] rounded-full border border-rose-500/30 bg-rose-500/15 px-3 py-1 text-xs text-rose-400">
              {vetoChangedDecision
                ? `1단계 거부권 발동 — 결론이 "${preVetoDecision}"에서 "${step8.finalDecision}"로 하향 조정됨`
                : `1단계 거부권 발동 — 원점수 기준으로도 이미 "${step8.finalDecision}"라 결론 변화 없음`}
            </span>
          )}
          {step8.positionSizePct !== null && (
            <span className="text-sm text-[var(--ink-dim)]">권장 매수 비중 {step8.positionSizePct}%</span>
          )}
        </div>
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

      <StepCard step={2} title="자본의 유동성" score={step2.finalScore} details={details?.step2} auxDetails={details?.step2Aux} tip={STEP_TIPS[2]} summary={details?.step2Summary}>
        <Field label="해외 지표 충족" value={`${step2.overseasQualifyingCount} / ${step2.overseasTotalCount}`} />
        <p className="mt-2 mb-1.5 text-xs text-[var(--ink-faint)]">
          Fed 대차대조표·M2 통화량·기준잔액·역레포·TGA·실질금리·크레딧 스프레드 7개 지표 중 "유동성 우호적" 방향으로
          움직인 게 몇 개인지 센 값이다(아래 상세 보기에서 지표별 충족 여부 확인 가능). 이 비율이 2단계 점수의 기반이 된다.
        </p>
      </StepCard>

      <StepCard step={3} title="캐리 트레이드" score={step3.score} details={details?.step3} tip={STEP_TIPS[3]} summary={details?.step3Summary}>
        <Field label="US10Y-JP10Y 스프레드" value={`${step3.spreadBp}bp`} />
        <Field label="구간(참고용, 미검증)" value={step3.zone} />
        {step3.warning && (
          <p className="mt-2 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{step3.warning}</p>
        )}
      </StepCard>

      <StepCard step={4} title="환율·금·유가" score={step4.score} details={details?.step4} auxDetails={details?.step4Aux} tip={STEP_TIPS[4]} summary={details?.step4Summary}>
        <Field label="사분면" value={step4.quadrant} />
        <Field label="달러 확인" value={step4.dollarConfirms ? "실질금리와 동행(신호 강함)" : "디커플링(경계)"} />
      </StepCard>

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

      <StepCard step={6} title="자본의 최종 목적지(섹터, 사후 확인용)" score={step6.score} details={details?.step6} detailsWideCriterion tip={STEP_TIPS[6]} summary={details?.step6Summary}>
        <Field label="충족 섹터" value={step6.qualifying.length > 0 ? step6.qualifying.join(", ") : "없음"} />
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
      </StepCard>

      {details?.step8 && details.step8.length > 0 && (
        <StepCard step={8} title="최종 결론 계산" details={details.step8} detailsHideMetColumn tip={STEP_TIPS[8]}>
          <Field label="투자 적합도 점수" value={step8.macroTrendScore.toFixed(2)} />
          <Field label="최종 결론" value={step8.finalDecision} />
        </StepCard>
      )}

      <p className="pt-4 text-center text-xs text-[var(--ink-faint)]">
        이 체크리스트는 검증된 필승 투자법이 아니라 조사를 도와주는 도구다. 투자 손실은 본인 책임이다.
      </p>
    </div>
  );
}
