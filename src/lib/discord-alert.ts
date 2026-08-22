// fetch()는 네트워크 자체가 끊기지 않는 한 4xx/5xx(웹훅 URL 무효화·레이트리밋 등)에도 절대
// throw하지 않는다 — res.ok를 직접 확인해 던지지 않으면, 호출부의 try/catch(pipeline.ts가
// 실패를 sourceErrors에 기록하는 그 로직)가 이 실패를 영원히 못 본다. 이 함수가 이 파일에서
// 유일하게 실제로 HTTP 요청을 보내는 지점이라 여기서만 고치면 두 알림 함수 다 적용된다.
async function postToDiscord(content: string): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL 환경변수 없음");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: ["everyone"] } }),
  });
  if (!res.ok) throw new Error(`Discord 웹훅 요청 실패: ${res.status} ${await res.text()}`);
}

// 헬스체크 크론(/api/cron/health-check)이 "오늘 리포트가 아예 없음" 또는 "리포트는 있지만
// 위 sendReportUploadedAlert가 실패했던 것으로 sourceErrors에 기록됨"을 감지했을 때 알림.
// 이게 마지막 보루라 실패해도 호출부가 죽지 않게 조용히 삼킨다(health-check 라우트 자체가
// 200을 반환해야 cron-job.org가 재시도하지 않고 넘어감).
export async function sendHealthCheckAlert(message: string): Promise<void> {
  try {
    await postToDiscord(`@everyone ⚠️ ${message}`);
  } catch {
    // 웹훅 자체가 죽었으면 여기서도 알릴 방법이 없다 — 조용히 넘어간다(더 위 계층 없음).
  }
}

// 새 데일리 리포트가 저장될 때마다 Discord 채널에 알림. pipeline.ts에서 report 저장 직후 호출,
// 실패하면 호출부가 sourceErrors에 기록한다(여기서는 삼키지 않고 그대로 던진다).
export async function sendReportUploadedAlert(marketDate: string, finalDecision: string, macroTrendScore: number): Promise<void> {
  await postToDiscord(
    `@everyone 📊 새 리포트 업로드됨 — ${marketDate} | 판단: ${finalDecision} | 매크로 추세 점수: ${macroTrendScore.toFixed(1)}/10\nhttps://capital-flow-tracker.vercel.app/report`
  );
}

// 옵시디언 안전망 크론 실패 전용 — "재시도" 버튼을 붙인다.
// DISCORD_WEBHOOK_URL(Incoming Webhook)로는 버튼을 못 보낸다 — Discord 공식 문서: "non-owned
// webhooks cannot send interactive components, and the components field will be ignored"
// (2026-08-22 실측 확인: 요청은 성공하는데 버튼만 조용히 사라짐). 봇이 채널에 직접 보내는 메시지는
// 이 제약이 없어서, 이 알림만 Bot API(POST /channels/{id}/messages, Authorization: Bot ...)로 보낸다.
// 버튼 클릭은 이 프로젝트가 아니라 같은 Discord Application("크론봇")의 Interactions Endpoint URL이
// 등록된 ai-macro-company/src/app/api/discord/interactions/route.ts가 받아서, custom_id로 분기해
// 이 프로젝트의 /api/cron/obsidian-export를 대신 호출해준다(Application당 Endpoint URL 1개뿐이라
// 이미 그쪽에 등록된 걸 재사용 — 초대·전송에 쓴 봇 토큰과는 무관, 인터랙션 응답은 자체 토큰으로 처리됨).
export async function sendObsidianExportFailureAlert(message: string): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (!botToken || !channelId) {
    // 봇 설정 전이면 최소한 텍스트 알림만이라도(버튼 없이) 기존 웹훅으로 보낸다 — 완전 무음보다 낫다.
    await sendHealthCheckAlert(message);
    return;
  }
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bot ${botToken}` },
      body: JSON.stringify({
        content: `@everyone ⚠️ ${message}`,
        allowed_mentions: { parse: ["everyone"] },
        components: [
          { type: 1, components: [{ type: 2, style: 4, label: "지금 재시도", custom_id: "retry-obsidian-export" }] },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Discord 봇 메시지 전송 실패: ${res.status} ${await res.text()}`);
  } catch {
    // sendHealthCheckAlert와 같은 원칙 — 이게 마지막 알림 경로라 실패해도 갈 곳이 없다.
  }
}
