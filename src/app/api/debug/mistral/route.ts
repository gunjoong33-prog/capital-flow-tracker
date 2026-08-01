import { NextResponse } from "next/server";
import { generateNarrative } from "@/lib/narrative";

// Mistral 키가 실제로 동작하는지 확인하는 진단용 엔드포인트.
// 무인증으로 배포돼 있으면 누구나 호출해 무료 티어 한도를 소진시킬 수 있어 cron과 같은 가드를 건다.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const text = await generateNarrative(
      "한 문장으로 자기소개해줘. 너는 매크로 자본흐름 분석 보조 AI야."
    );
    return Response.json({ ok: true, text });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
