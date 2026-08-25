import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// .github/workflows/auto-fix.yml이 성공/실패 두 경로 모두에서 결과를 이 라우트로 보고한다.
// AutoFixLog는 self-diagnosis 크론이 생성만 하고 아무도 업데이트를 안 해서(최종 리뷰 지적),
// 하루 자동배포 상한(self-diagnosis.ts의 deployed: true 카운트)이 죽은 코드였다 — 이 라우트가
// 그 유일한 업데이트 경로다.
interface AutoFixResultBody {
  logId: string;
  testsPassed: boolean;
  protectedFileTouched: boolean;
  deployed: boolean;
  prUrl?: string;
  attemptedFix?: string;
}

export async function POST(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json()) as AutoFixResultBody;
  if (!body.logId) {
    return NextResponse.json({ error: "logId 필수" }, { status: 400 });
  }

  try {
    await db.autoFixLog.update({
      where: { id: body.logId },
      data: {
        testsPassed: body.testsPassed,
        protectedFileTouched: body.protectedFileTouched,
        deployed: body.deployed,
        prUrl: body.prUrl,
        attemptedFix: body.attemptedFix,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Prisma는 update 대상 row가 없으면 P2025로 throw한다 — logId 오타·이미 삭제된 로그를
    // 서버 에러(500)로 흘리지 않고 404로 명확히 구분해준다.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "logId에 해당하는 AutoFixLog 없음" }, { status: 404 });
    }
    throw err;
  }
}
