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
