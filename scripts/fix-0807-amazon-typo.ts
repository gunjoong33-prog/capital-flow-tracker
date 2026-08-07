// 8/7 리포트 details.step5BigTech의 아마존 항목에 "웃었음에도"(웃다=laugh) 오타 —
// "웃돌았음에도"(웃돌다=exceed)가 맞는 표현. Groq(gpt-oss-120b, reasoning_effort=low)가
// bigtech-reasons.ts에서 자유생성한 텍스트의 일회성 오타로 확인(다른 날짜 전수 조사 결과
// 재발 없음 — 코드 수정 아닌 단순 데이터 교정).
import "dotenv/config";
import { db } from "../src/lib/db";
import { Prisma } from "../src/generated/prisma/client";

async function main() {
  const date = new Date("2026-08-07T00:00:00.000Z");
  const report = await db.dailyReport.findUnique({ where: { date }, select: { details: true } });
  if (!report) {
    console.log("리포트 없음");
    return;
  }

  const details = report.details as Record<string, unknown>;
  const bigTech = details.step5BigTech as { label: string; value: string; met: null; criterion: string }[];
  const amzn = bigTech.find((b) => b.label.includes("아마존"));
  if (!amzn) {
    console.log("아마존 항목 없음");
    return;
  }
  if (!amzn.value.includes("웃었음에도")) {
    console.log("이미 수정됨 또는 패턴 불일치:", amzn.value);
    return;
  }

  console.log("수정 전:", amzn.value);
  amzn.value = amzn.value.replace("웃었음에도", "웃돌았음에도");
  console.log("수정 후:", amzn.value);

  const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;
  await db.dailyReport.update({ where: { date }, data: { details: asJson(details) } });
  console.log("저장 완료");
}
main().then(() => db.$disconnect());
