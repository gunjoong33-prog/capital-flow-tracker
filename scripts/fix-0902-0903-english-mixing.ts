// 9/2·9/3(marketDate 기준) 종합보고서에 "although", "unusual한", "조금flows됐지만",
// "uncertainties(불확실성)"처럼 영어 단어가 한글 문장에 섞인 것을 고친다(comprehensive-report.ts
// 프롬프트를 예시 블랙리스트→카테고리 허용목록으로 강화 + narrative.ts 자가검수 패스에 영어 검사
// 추가 후 재생성). 숫자는 이미 맞으므로 asOf 재구성 없이 저장된 step1~8/details 그대로 재사용
// (fix-0831-0901-comprehensive-format.ts와 동일한 패턴).
//
// 2026-09-04: 이 스크립트는 아직 실행 못 함 — Mistral API 키가 x-ratelimit-limit-req-minute: 0으로
// 완전히 막힌 상태(결제수단 미등록 계정이 더 강하게 제한된 것으로 추정, 403이던 큰 모델뿐 아니라
// 작은 모델까지). Groq(gpt-oss-120b)로 대체 시도했으나 이 프롬프트가 약 22,000토큰이라 Groq
// 무료 티어 TPM 한도(8,000)를 넘겨 그마저도 불가 — 사용자 결정: "9/2·9/3 재생성은 보류, 코드
// 수정만 지금 배포". Mistral 계정이 복구되면(x-ratelimit-limit-req-minute이 0보다 커지면) 이
// 스크립트를 그대로 재실행해라.
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";
import { generateComprehensiveReport } from "../src/lib/comprehensive-report";
import { findStrayEnglishWords } from "../src/lib/text-format";
import type { StepDetails } from "../src/lib/scoring/types";

async function regen(marketDateStr: string) {
  const marketDate = new Date(`${marketDateStr}T00:00:00.000Z`);
  const existing = await db.dailyReport.findUnique({ where: { marketDate } });
  if (!existing) {
    console.log(`${marketDateStr} 리포트 없음, 중단`);
    return;
  }

  const details = existing.details as unknown as StepDetails;
  const report = {
    step1: existing.step1,
    step2: existing.step2,
    step3: existing.step3,
    step4: existing.step4,
    step5: existing.step5,
    step6: existing.step6,
    step7: existing.step7,
    step8: existing.step8,
  };

  const comprehensiveReport = await generateComprehensiveReport({ ...report, details });
  const stray = findStrayEnglishWords(comprehensiveReport);
  console.log(`\n--- ${marketDateStr} comprehensiveReport (stray english: ${stray.join(", ") || "none"}) ---`);
  console.log(comprehensiveReport);

  const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
  await db.dailyReport.update({
    where: { marketDate },
    data: { details: asJson({ ...details, comprehensiveReport }) },
  });
  console.log(`${marketDateStr} 종합보고서 갱신 완료`);
}

async function main() {
  // 직전 두 차례 시도 모두 즉시 429(무료 티어 분당 한도) — 재시도 로직의 최대 60초 대기로도
  // 부족했다. 시작 전에 여유 있게 더 기다린다.
  await new Promise((r) => setTimeout(r, 90_000));
  await regen("2026-09-02");
  await regen("2026-09-03");
}

main().then(() => db.$disconnect());
