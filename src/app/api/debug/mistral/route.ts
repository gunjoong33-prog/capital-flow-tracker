import { generateNarrative } from "@/lib/narrative";
import { requireCronAuth } from "@/lib/cron-auth";

// Mistral 키가 실제로 동작하는지 확인하는 진단용 엔드포인트.
// 무인증으로 배포돼 있으면 누구나 호출해 무료 티어 한도를 소진시킬 수 있어 cron과 같은 가드를 건다.
//
// generateNarrative가 두 번의 Mistral 호출(초안 + 자가검수) 사이에 항상 20초 sleep을 두므로
// (narrative.ts:58, 레이트리밋 회피) 이 라우트도 최소 20초+API 응답시간이 걸린다. Vercel 기본
// maxDuration(플랜에 따라 10~15초)로는 무조건 504가 난다(재리뷰 지적) — external-consensus.ts와
// 같은 패턴으로 넉넉히 60초로 늘린다.
export const maxDuration = 60;
export async function GET(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

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
