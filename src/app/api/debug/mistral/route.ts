import { generateNarrative } from "@/lib/narrative";

// Gemini 키가 실제로 동작하는지 확인하는 진단용 엔드포인트.
export async function GET() {
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
