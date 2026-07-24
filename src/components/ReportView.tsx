import { StepCard, Field } from "@/components/StepCard";
import { ScoreBadge, DecisionBadge } from "@/components/ScoreBadge";
import type {
  Step1Result, Step2Result, Step3Result, Step4Result,
  Step5Result, Step6Result, Step7Result, Step8Result,
  StepDetails,
} from "@/lib/scoring/types";

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
  narrative,
  details,
}: {
  dateLabel: string;
  report: ReportViewData;
  narrative?: string | null;
  details?: StepDetails | null;
}) {
  const { step1, step2, step3, step4, step5, step6, step7, step8 } = report;

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="text-sm text-zinc-500">{dateLabel} · 자본 흐름 체크리스트</p>
        <div className="flex flex-wrap items-center gap-3">
          <DecisionBadge decision={step8.finalDecision} />
          <ScoreBadge score={step8.macroTrendScore} label="매크로 추세 점수" />
          {step8.vetoApplied && (
            <span className="rounded-full border border-rose-500/30 bg-rose-500/15 px-3 py-1 text-xs text-rose-400">
              1단계 거부권 발동 — 한 단계 하향 조정됨
            </span>
          )}
          {step8.positionSizePct !== null && (
            <span className="text-sm text-zinc-400">권장 매수 비중 {step8.positionSizePct}%</span>
          )}
        </div>
      </header>

      {narrative && (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 text-sm leading-relaxed text-zinc-300">
          {narrative}
        </p>
      )}

      <StepCard step={1} title="글로벌 환경" details={details?.step1}>
        <Field label="거부권 발동" value={step1.vetoTriggered ? "예" : "아니오"} />
        <Field label="사유" value={step1.reason} />
      </StepCard>

      <StepCard step={2} title="자본의 유동성" score={step2.finalScore} details={details?.step2}>
        <Field label="해외 지표 충족" value={`${step2.overseasQualifyingCount} / ${step2.overseasTotalCount}`} />
        <Field label="국내 지표 보정" value={step2.domesticAdjustment > 0 ? `+${step2.domesticAdjustment}` : step2.domesticAdjustment} />
      </StepCard>

      <StepCard step={3} title="캐리 트레이드" score={step3.score} details={details?.step3}>
        <Field label="US10Y-JP10Y 스프레드" value={`${step3.spreadBp}bp`} />
        <Field label="구간(참고용, 미검증)" value={step3.zone} />
        {step3.warning && (
          <p className="mt-2 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{step3.warning}</p>
        )}
      </StepCard>

      <StepCard step={4} title="환율·금·유가" score={step4.score} details={details?.step4}>
        <Field label="사분면" value={step4.quadrant} />
        <Field label="달러 확인" value={step4.dollarConfirms ? "실질금리와 동행(신호 강함)" : "디커플링(경계)"} />
        <p className="mt-2 text-xs text-zinc-500">{step4.note}</p>
      </StepCard>

      <StepCard step={5} title="규모별·성격별 자금 도착" score={step5.score} details={details?.step5}>
        <Field label="나스닥-러셀 격차" value={`${step5.gapPp.toFixed(2)}%p`} />
        <Field label="쏠림 경계" value={step5.concentrationWarning ? "예" : "아니오"} />
        <Field label="위험선호" value={step5.riskAppetite} />
        {step5.cryptoAlignsWithRisk !== null && (
          <Field label="암호화폐 동조" value={step5.cryptoAlignsWithRisk ? "나스닥과 같은 방향" : "괴리(고유 이슈 가능)"} />
        )}
      </StepCard>

      <StepCard step={6} title="자본의 최종 목적지(섹터, 사후 확인용)" score={step6.score} details={details?.step6}>
        <Field label="충족 섹터" value={step6.qualifying.length > 0 ? step6.qualifying.join(", ") : "없음"} />
      </StepCard>

      <StepCard step={7} title="심리 필터(합산 제외, 포지션 크기 조절용)" details={details?.step7}>
        <Field label="양쪽 과열" value={step7.bothOverheated ? "예 — 매수 크기 30% 축소" : "아니오"} />
        <Field label="공포 구간" value={step7.fearZone ? "예 — 역발상 기회 고려" : "아니오"} />
      </StepCard>

      {details?.step8 && details.step8.length > 0 && (
        <StepCard step={8} title="최종 결론 계산" details={details.step8}>
          <Field label="매크로 추세 점수" value={step8.macroTrendScore.toFixed(2)} />
          <Field label="최종 결론" value={step8.finalDecision} />
        </StepCard>
      )}

      <p className="pt-4 text-center text-xs text-zinc-600">
        이 체크리스트는 검증된 필승 투자법이 아니라 조사를 도와주는 도구다. 투자 손실은 본인 책임이다.
      </p>
    </div>
  );
}
