// ExternalConsensus 누적 데이터에서 "이 기관은 어떤 지표를 어떤 논리로 해석해 이런 결론에
// 도달했는가"를 LLM으로 distill해 LearningNote에 저장 + 옵시디언 "학습" 폴더로 내보낸다.
// 서술 품질이 중요한 작업이라 narrative.ts와 같은 이유로 Mistral을 쓴다(llm-clients.ts 주석 참고).
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { callMistral } from "@/lib/llm-clients";
import { upsertObsidianFile } from "@/lib/obsidian-export";

// Prisma의 Json 컬럼은 구체 타입을 그대로 받아주지 않으므로(인덱스 시그니처 요구),
// pipeline.ts·external-consensus.ts와 같은 방식으로 캐스팅한다.

// institutional-research.ts의 네이버금융 수집기가 sourceName을 "${broker}:${title}" 형태로
// 만든다 — 콜론(:)은 NTFS(Windows)에서 파일명에 못 쓰는 문자라, 이 값을 그대로 옵시디언 파일
// 경로에 쓰면 GitHub엔 커밋되지만 Windows에서 로컬로 pull/checkout할 때 실패한다(실측: git이
// "invalid path" 에러로 거부, rebase/reset 전체가 막힘). ExternalConsensus의 upsert 유니크 키
// (sourceType, sourceName, date)는 원본 sourceName을 그대로 써야 하므로 sourceName 자체는
// 안 건드리고, 파일 경로로 쓸 때만 별도로 안전화한다.
function sanitizeForFilename(name: string): string {
  return name.replace(/[:*?"<>|\\/]/g, "-").trim();
}
const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;

type ConsensusRecord = { id: string; sourceType: string; date: Date; payload: unknown };

const CATEGORY_BY_SOURCE_TYPE: Record<string, string> = {
  "13f": "헤지펀드",
  bis: "은행",
  domestic_broker: "증권사",
  finnhub: "증권사",
  news_quote: "은행",
  // institutional-research.ts(2026-09-01 추가)가 쌓는 7개 신규 소스 — 매핑이 없으면 전부
  // "증권사"로 뭉뚱그려지는데, Fed·ECB는 은행이 아니라 중앙은행, World Bank는 증권사가 아니라
  // 국제기구라 옵시디언 학습 폴더 분류(학습/{category}/{sourceName}.md)가 부정확해진다.
  naver_research: "증권사",
  sec_8k: "기업공시",
  fed: "중앙은행",
  ecb: "중앙은행",
  world_bank: "국제기구",
  pimco: "자산운용사",
  blackrock: "자산운용사",
  // 2026-09-02(보류 기관 6곳 중 5곳 재조사 후 연동) — 기존 bis(SDMX 수치 데이터, "은행"으로 분류됨)
  // 와는 다른 소스라 bis_qr로 분리.
  bis_qr: "국제기구",
  bok_report: "중앙은행",
  kcmi_report: "공적연구기관",
  jpm_am: "자산운용사",
  miraeasset_research: "증권사",
};

// LearningNote.periodKey에 쓰는 ISO 8601 주차 키(예: "2026-W36") — 마이그레이션의 백필 SQL
// (TO_CHAR(..., 'IYYY"-W"IW'))과 반드시 같은 결과를 내야 한다(목요일 기준 ISO 주차 계산).
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7; // 월=1 ... 일=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // 이번 ISO 주의 목요일로 이동
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// 13F 보유내역처럼 payload가 배열인 소스는 한 기관이 1000건 가까이 될 수 있어 그대로
// JSON.stringify하면 Mistral 컨텍스트 윈도우를 넘긴다(최종 리뷰 지적). 배열 payload만
// 상위 N건으로 자른다 — BIS·Finnhub·국내컨센서스 같은 단일 객체 payload는 원래 작아서 안 건드림.
const MAX_ARRAY_PAYLOAD_ENTRIES = 20;

function capArrayPayload(payload: unknown): { payload: unknown; truncated: boolean; totalCount: number } {
  if (!Array.isArray(payload) || payload.length <= MAX_ARRAY_PAYLOAD_ENTRIES) return { payload, truncated: false, totalCount: 0 };

  const totalCount = payload.length;
  const first = payload[0];
  // 정렬 기준 숫자 필드를 첫 항목에서 찾는다(13F holdings면 valueThousands) — 못 찾으면 원래 순서 유지.
  const sortKey =
    first && typeof first === "object"
      ? Object.keys(first as Record<string, unknown>).find((k) => typeof (first as Record<string, unknown>)[k] === "number")
      : undefined;
  const ordered = sortKey
    ? [...payload].sort((a, b) => (b as Record<string, number>)[sortKey] - (a as Record<string, number>)[sortKey])
    : payload;
  return { payload: ordered.slice(0, MAX_ARRAY_PAYLOAD_ENTRIES), truncated: true, totalCount };
}

export function buildDistillPrompt(sourceName: string, records: ConsensusRecord[]): string {
  const truncationNotes: string[] = [];
  const cappedRecords = records.map((r) => {
    const { payload, truncated, totalCount } = capArrayPayload(r.payload);
    if (truncated) {
      truncationNotes.push(`(${r.sourceType} ${r.date.toISOString().slice(0, 10)}: 상위 ${MAX_ARRAY_PAYLOAD_ENTRIES}건만 표시, 전체 ${totalCount}건 중)`);
    }
    return { ...r, payload };
  });

  return `너는 매크로 리서치 애널리스트다. 아래는 "${sourceName}"의 최근 공개 데이터다.
이 데이터만 근거로 다음 세 가지를 한국어 3~5문장으로 요약해라 — 이 기관이 ① 어떤 지표를 근거로
쓰는지(지표 수집 방법), ② 그 지표를 어떤 논리로 해석해 어떤 결론에 도달하는지(사고 과정),
③ 결론을 어떤 형식·어조로 전달하는지(보고 방식 — 예: 수치를 먼저 제시하는지 서술을 먼저 하는지,
확정적으로 단언하는지 조건부로 표현하는지, 몇 개 시나리오로 나누는지 등).
데이터에 없는 내용을 지어내지 마라. 존댓말 아닌 평서체로.
${truncationNotes.length > 0 ? `\n${truncationNotes.join("\n")}\n` : ""}
데이터:
${JSON.stringify(cappedRecords, null, 2)}`;
}

/** 최근 7일간 쌓인 ExternalConsensus를 sourceName별로 묶어 distill하고, DB 저장 + 옵시디언 커밋까지 한다. */
export async function distillAndSaveLearningNotes(): Promise<{ saved: number; errors: string[] }> {
  const errors: string[] = [];
  let saved = 0;

  const since = new Date(Date.now() - 7 * 86_400_000);
  // date는 13F 행이면 SEC 제출일(최대 45일 전일 수 있음)이라 "이번 주에 수집된 데이터"를 걸러내는
  // 기준으로 쓰면 거의 즉시 7일 창을 벗어나 영원히 distill 안 되는 버그였다(최종 리뷰 지적).
  // createdAt(행이 실제로 DB에 저장된 시각)이 "이번 주에 수집됨"의 올바른 기준이다.
  const records = await db.externalConsensus.findMany({ where: { createdAt: { gte: since } } });

  const bySource = new Map<string, ConsensusRecord[]>();
  for (const r of records) {
    const list = bySource.get(r.sourceName) ?? [];
    list.push({ id: r.id, sourceType: r.sourceType, date: r.date, payload: r.payload });
    bySource.set(r.sourceName, list);
  }

  const githubToken = process.env.GITHUB_EXPORT_TOKEN;
  // 이번 실행 전체가 같은 주차 키를 쓴다 — 같은 주 안에서 몇 번을 재실행해도(수동 재실행,
  // 겹치는 크론 등) sourceName당 행이 하나로 upsert된다(2026-09-01, 근중복 11건 정리 후 추가).
  const periodKey = isoWeekKey(new Date());

  // institutional-research.ts(2026-09-01)가 기관당 원문 하나하나에 별도 sourceName을 매겨
  // 그룹 수가 5개 안팎에서 20개 이상으로 늘었다 — 순차 처리(1건씩 대기)로는 Mistral 호출만
  // 20건 넘게 이어져 함수 시간제한(맨 아래 route의 maxDuration)을 넘긴다(실측: 504 타임아웃).
  // mistral-small은 초당 요청 한도가 있어 무제한 병렬은 429를 유발하므로, CONCURRENCY만큼만
  // 동시에 처리하는 배치 방식으로 총 대기시간을 줄인다.
  const CONCURRENCY = 3;
  const entries = [...bySource.entries()];

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ([sourceName, sourceRecords]) => {
        try {
          const summary = await callMistral(buildDistillPrompt(sourceName, sourceRecords), 1024, 0.3);
          return { sourceName, sourceRecords, summary };
        } catch (e) {
          errors.push(`Mistral distill 실패(${sourceName}): ${e instanceof Error ? e.message : String(e)}`);
          return null;
        }
      })
    );

    for (const result of results) {
      if (!result) continue;
      const { sourceName, sourceRecords, summary } = result;
      const category = CATEGORY_BY_SOURCE_TYPE[sourceRecords[0].sourceType] ?? "증권사";

      const note = await db.learningNote.upsert({
        where: { sourceName_periodKey: { sourceName, periodKey } },
        create: { category, sourceName, periodKey, summary, basedOn: asJson(sourceRecords.map((r) => r.id)) },
        update: { category, summary, basedOn: asJson(sourceRecords.map((r) => r.id)) },
      });
      saved++;

      if (githubToken) {
        const repoPath = `obsidian-export/학습/${category}/${sanitizeForFilename(sourceName)}.md`;
        const content = `# ${sourceName}\n\n**분류**: ${category}\n**최종 업데이트**: ${note.createdAt.toISOString().slice(0, 10)}\n\n${summary}\n`;
        const { status, detail } = await upsertObsidianFile(repoPath, content, githubToken);
        if (status === "error") errors.push(`옵시디언 커밋 실패(${sourceName}): ${detail ?? "알 수 없는 오류"}`);
      }
    }
  }

  return { saved, errors };
}
