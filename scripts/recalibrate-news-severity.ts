// P0(뉴스 심각도 캘리브레이션)는 원래 "앞으로 새로 들어오는 뉴스부터만" 적용하도록 설계했다(과거
// LLM 판정은 데이터 정직성 원칙상 소급 재작성하지 않는다는 이 프로젝트의 기존 원칙을 따른 것).
// 사용자가 "그래도 지금 저장된 7일치를 새 규칙으로 강제 재분류해달라"고 명시적으로 선택해서
// 예외적으로 과거 판정을 덮어쓴다 — 이 스크립트를 다시 쓸 일이 있으면 이번에도 이렇게 원칙에서
// 벗어난 예외라는 걸 사용자에게 먼저 확인할 것.
import "dotenv/config";
import { db } from "../src/lib/db";
import { callMistral, extractJsonArray } from "../src/lib/llm-clients";
import {
  capScheduledPolicyMeetingSeverity,
  downgradeUnsupportedHigh,
  type NewsSeverity,
} from "../src/lib/news-events";

const MAX_HIGH_PER_WINDOW = 2;

async function main() {
  const asOf = new Date();
  const since = new Date(asOf);
  since.setUTCDate(since.getUTCDate() - 7);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await db.newsEvent.findMany({
    where: { date: { gte: since, lte: asOf } },
    orderBy: [{ date: "desc" }],
  });
  if (rows.length === 0) {
    console.log("7일 창에 뉴스 없음");
    return;
  }

  const list = rows.map((r, i) => `${i + 1}. ${r.title} — ${r.summary}`).join("\n");
  const prompt = `너는 매크로 자본흐름 분석가다. 아래는 이미 "리스크 뉴스"로 분류된 항목 목록이다(제목 —
요약). 이 중 실제로 시장을 흔들 수준인지 다시 심각도(severity)를 매겨라(3단계):
- "high": 이 사건 하나만으로도 시장이 즉시 크게 흔들릴 수준(예: 실제 무력 충돌·전쟁 발발, 국가 디폴트,
  예상 밖 긴급 금리 결정, 주요 은행·금융기관 파산, 정부 붕괴). "high"는 매우 드물어야 한다 — 일주일에
  실제로 이 정도 사건이 여러 건 겹치는 경우는 거의 없다. 확전 "가능성", 긴장 "고조", 발언·경고 수준은
  아무리 자극적으로 보도돼도 high가 아니라 medium/low다.
- "medium": 명확한 리스크 요인이고 시장이 반응할 만하지만, 이미 진행 중인 사안의 추가 조치·확전 신호
  수준.
- "low": 리스크 요인이긴 하나 아직 경고·발언·우려 표명 수준이라 단독 영향은 제한적인 경우.

"high"로 매긴 항목은 evidence 필드에 "어떤 국가/기관이 무엇을 했는가"를 사실 하나로 구체적으로 적어라.
그 정도로 구체적인 실제 행동이 제목·요약에 없으면 애초에 high로 매기지 마라.

아래 JSON 배열 형식으로 목록의 모든 항목에 대해(순서·번호 그대로) 답해라. 다른 텍스트는 쓰지 마라:
[{"index": 번호, "severity": "medium", "evidence": ""}]

목록:
${list}`;

  const text = await callMistral(prompt, 8192);
  const parsed = extractJsonArray<{ index: number; severity?: string; evidence?: string }>(text);
  if (!parsed) {
    console.log("재분류 응답 파싱 실패, 중단");
    return;
  }

  const bySeverity = new Map<number, NewsSeverity>();
  for (const p of parsed) {
    const raw = p.severity === "high" || p.severity === "medium" || p.severity === "low" ? p.severity : "medium";
    bySeverity.set(p.index, downgradeUnsupportedHigh(raw, p.evidence));
  }

  // 배치 캡은 원래 코드와 같은 순서(날짜 desc)로 적용 — 최근 것부터 high를 우선 인정.
  let highCount = 0;
  let updated = 0;
  let downgraded = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let severity = bySeverity.get(i + 1) ?? "medium";
    severity = capScheduledPolicyMeetingSeverity(row.title, severity);
    if (severity === "high") {
      highCount++;
      if (highCount > MAX_HIGH_PER_WINDOW) severity = "medium";
    }
    if (severity !== row.severity) {
      if (row.severity === "high" && severity !== "high") downgraded++;
      await db.newsEvent.update({ where: { id: row.id }, data: { severity } });
      updated++;
    }
  }

  console.log(`${rows.length}건 재검토, ${updated}건 변경(그중 high→하향 ${downgraded}건)`);
}

main().then(() => db.$disconnect());
