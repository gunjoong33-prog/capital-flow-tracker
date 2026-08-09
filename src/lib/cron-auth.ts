import { NextResponse } from "next/server";

/**
 * 크론·디버그 엔드포인트 6곳이 전부 같은 인증 로직을 복붙해서 썼는데, 예전 버전은
 * `if (process.env.CRON_SECRET && authHeader !== ...)` 형태라 CRON_SECRET이 어쩌다
 * (오타·Vercel 콘솔 실수 등으로) 비어있으면 `&&`가 그냥 끊겨서 인증 자체가 통째로 뚫렸다
 * (fail-open — 실제 코드 감사로 발견). 여기서는 시크릿이 없으면 무조건 거부(fail-closed)한다.
 */
export function requireCronAuth(request: Request): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
