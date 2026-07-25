import { getManualInputsForDate } from "@/lib/manual-inputs";
import { submitManualInputs } from "./actions";
import { SiteNav } from "@/components/SiteNav";

export const dynamic = "force-dynamic";

export default async function ManualInputPage() {
  const today = new Date().toISOString().slice(0, 10);
  const current = await getManualInputsForDate(today);

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <main className="mx-auto max-w-xl space-y-6">
        <SiteNav active="manual-input" />

        <div className="space-y-1">
          <h1 className="text-lg font-medium">오늘의 수동 입력</h1>
          <p className="text-sm text-zinc-500">
            자동으로 가져올 수 없는 항목들이다. 매일 아침 9시 자동 실행 전에 입력해두면 그날 리포트부터 반영된다.
            비워두면 기존처럼 안전한 기본값(거부권 없음·급등 없음·확인 못함)으로 계산된다.
          </p>
        </div>

        <form action={submitManualInputs} className="space-y-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <label className="block space-y-1">
            <span className="text-sm text-zinc-300">최근 7일 내 시장을 흔든 뉴스 건수</span>
            <input
              type="number"
              name="newsCount"
              min={0}
              defaultValue={current.newsCountLast7Days}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
            <span className="block text-xs text-zinc-600">
              3건 이상이면 1단계 거부권 발동(전쟁·대선·무역분쟁 등 지정학 리스크 뉴스 기준)
            </span>
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" name="bigEvent" defaultChecked={current.hasBigEventNext14Days} className="h-4 w-4" />
            <span className="text-sm text-zinc-300">14일 내 큰 이벤트(FOMC 등) 예정</span>
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" name="jpyVolSpike" defaultChecked={current.jpyVolSpike} className="h-4 w-4" />
            <span className="text-sm text-zinc-300">엔화(USD/JPY) 변동성 급등 감지 — 3단계 스프레드 구간표보다 우선</span>
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-zinc-300">CNN 공포와 탐욕 지수 (0~100, 모르면 비워두기)</span>
            <input
              type="number"
              name="fearGreed"
              min={0}
              max={100}
              defaultValue={current.fearGreed ?? ""}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" name="domesticWeightHigh" defaultChecked={current.domesticWeightHigh} className="h-4 w-4" />
            <span className="text-sm text-zinc-300">국내(한국) 자산 비중이 높다</span>
          </label>
          <p className="-mt-4 text-xs text-zinc-600">
            이 항목만 그날그날이 아니라 다시 바꾸기 전까지 계속 유지되는 설정이다.
          </p>

          <button
            type="submit"
            className="w-full rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
          >
            저장
          </button>
        </form>
      </main>
    </div>
  );
}
