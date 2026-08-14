// 헬스체크 크론(/api/cron/health-check)이 "오늘 리포트가 아예 없음" 또는 "리포트는 있지만
// 위 sendReportUploadedAlert가 실패했던 것으로 sourceErrors에 기록됨"을 감지했을 때 알림.
export async function sendHealthCheckAlert(message: string): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `@everyone ⚠️ ${message}`,
      allowed_mentions: { parse: ["everyone"] },
    }),
  });
}

// 새 데일리 리포트가 저장될 때마다 Discord 채널에 알림. pipeline.ts에서 report 저장 직후 호출.
export async function sendReportUploadedAlert(marketDate: string, finalDecision: string, macroTrendScore: number): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `@everyone 📊 새 리포트 업로드됨 — ${marketDate} | 판단: ${finalDecision} | 매크로 추세 점수: ${macroTrendScore.toFixed(1)}/10\nhttps://capital-flow-tracker.vercel.app/report`,
      allowed_mentions: { parse: ["everyone"] },
    }),
  });
}
