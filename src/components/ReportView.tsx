import { StepCard, Field } from "@/components/StepCard";
import { ScoreBadge, DecisionBadge } from "@/components/ScoreBadge";
import { STEP_TIPS } from "@/lib/scoring/tips";
import type {
  Step1Result, Step2Result, Step3Result, Step4Result,
  Step5Result, Step6Result, Step7Result, Step8Result,
  StepDetails,
} from "@/lib/scoring/types";

// 1단계 리스크 뉴스 심각도별 표시 스타일. high=단독으로도 즉시 거부권 발동, medium=명확한 리스크지만
// 실제 조치·확전 신호 수준, low=경고·우려 표명 수준(누적돼야 리스크로 봄) — pure.ts newsItemWeight 참고.
const SEVERITY_STYLE: Record<
  "high" | "medium" | "low",
  { box: string; text: string; badge: string; link: string; label: string }
> = {
  high: {
    box: "bg-rose-500/10",
    text: "text-rose-300",
    badge: "bg-rose-500/30 text-rose-200",
    link: "text-rose-400 hover:text-rose-300",
    label: "심각 · 단독 즉시발동",
  },
  medium: {
    box: "bg-amber-500/10",
    text: "text-amber-300",
    badge: "bg-amber-500/30 text-amber-200",
    link: "text-amber-400 hover:text-amber-300",
    label: "중간",
  },
  low: {
    box: "bg-zinc-500/10",
    text: "text-zinc-400",
    badge: "bg-zinc-500/30 text-zinc-300",
    link: "text-zinc-400 hover:text-zinc-300",
    label: "경미 · 누적형",
  },
};

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

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="text-sm text-zinc-500">{dateLabel} · 자본 흐름 체크리스트</p>
        <div className="flex flex-wrap items-center gap-3">
          <DecisionBadge decision={step8.finalDecision} />
          <ScoreBadge score={step8.macroTrendScore} label="투자 적합도 점수" />
          {step8.vetoApplied && (
            <span className="[word-break:keep-all] rounded-full border border-rose-500/30 bg-rose-500/15 px-3 py-1 text-xs text-rose-400">
              1단계 거부권 발동 — 한 단계 하향 조정됨
            </span>
          )}
          {step8.positionSizePct !== null && (
            <span className="text-sm text-zinc-400">권장 매수 비중 {step8.positionSizePct}%</span>
          )}
        </div>
      </header>

      {details?.comprehensiveReport && (
        <div>
          <input type="checkbox" id="comprehensive-report-toggle" className="peer hidden" />
          <label
            htmlFor="comprehensive-report-toggle"
            className="flex cursor-pointer select-none items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800 peer-checked:hidden"
          >
            종합 보고서 보기
          </label>
          <label
            htmlFor="comprehensive-report-toggle"
            className="hidden cursor-pointer select-none items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800 peer-checked:flex"
          >
            종합 보고서 접기
          </label>
          <div className="mt-3 hidden whitespace-pre-line [word-break:keep-all] rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 text-sm leading-relaxed text-zinc-300 peer-checked:block">
            {details.comprehensiveReport}
          </div>
        </div>
      )}

      <StepCard step={1} title="글로벌 환경" details={details?.step1} tip={STEP_TIPS[1]}>
        <Field label="거부권 발동" value={step1.vetoTriggered ? "예" : "아니오"} />
        <Field label="사유" value={step1.reason} />
        {step1.riskyNews && step1.riskyNews.length > 0 && (
          <div className="mt-3 space-y-2">
            {step1.riskyNews.map((n, i) => {
              const style = SEVERITY_STYLE[n.severity];
              return (
                <div key={i} className={`rounded-md px-3 py-2 text-xs ${style.box}`}>
                  <p className={`[word-break:keep-all] ${style.text}`}>
                    <span className={`mr-1 rounded px-1 py-0.5 text-[10px] font-medium ${style.badge}`}>
                      {style.label}
                    </span>
                    {n.summary}
                  </p>
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className={`mt-1 inline-block underline ${style.link}`}>
                    기사 보기 →
                  </a>
                </div>
              );
            })}
          </div>
        )}
        {step1.recentEventOutcomes && step1.recentEventOutcomes.filter((o) => o.risky).length > 0 && (
          <div className="mt-3 space-y-2">
            {step1.recentEventOutcomes.filter((o) => o.risky).map((o, i) => (
              <div key={i} className="[word-break:keep-all] rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {o.name}({o.date}) 결과가 예상 밖입니다 — {o.detail}
              </div>
            ))}
          </div>
        )}
        {step1.upcomingEvents && step1.upcomingEvents.length > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            14일 내 예정된 이벤트: {step1.upcomingEvents.map((e) => `${e.name}(${e.date})`).join(", ")}
          </p>
        )}
      </StepCard>

      <StepCard step={2} title="자본의 유동성" score={step2.finalScore} details={details?.step2} auxDetails={details?.step2Aux} tip={STEP_TIPS[2]} summary={details?.step2Summary}>
        <Field label="해외 지표 충족" value={`${step2.overseasQualifyingCount} / ${step2.overseasTotalCount}`} />
        <p className="-mt-1 mb-1.5 text-xs text-zinc-500">
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
            className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            S&P500 히트맵(Finviz) →
          </a>
          <a
            href="https://www.trendforce.com"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
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
        <Field label="공포 구간" value={step7.fearZone ? "예 — 역발상 기회 고려" : "아니오"} />
      </StepCard>

      {details?.step8 && details.step8.length > 0 && (
        <StepCard step={8} title="최종 결론 계산" details={details.step8} detailsHideMetColumn tip={STEP_TIPS[8]}>
          <Field label="투자 적합도 점수" value={step8.macroTrendScore.toFixed(2)} />
          <Field label="최종 결론" value={step8.finalDecision} />
        </StepCard>
      )}

      <p className="pt-4 text-center text-xs text-zinc-600">
        이 체크리스트는 검증된 필승 투자법이 아니라 조사를 도와주는 도구다. 투자 손실은 본인 책임이다.
      </p>
    </div>
  );
}
