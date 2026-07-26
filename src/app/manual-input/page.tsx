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
            뉴스 판정·FOMC/CPI/고용지표 일정·엔화 변동성 급등은 이제 매일 자동으로 계산된다.
            공식 API가 없는 CNN 공포탐욕지수만 여기서 직접 입력한다.
          </p>
        </div>

        <form action={submitManualInputs} className="space-y-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
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
