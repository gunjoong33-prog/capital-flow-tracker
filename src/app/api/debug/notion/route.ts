import { getNotionClient, NOTION_PAGE_IDS } from "@/lib/notion";

// 통합 토큰이 두 페이지에 실제로 연결됐는지 확인하는 진단용 엔드포인트.
// 읽기만 한다 — 아무것도 쓰거나 바꾸지 않음.
export async function GET() {
  const notion = getNotionClient();
  const result: Record<string, unknown> = {};

  try {
    const page = await notion.pages.retrieve({ page_id: NOTION_PAGE_IDS.CHECKLIST_TEMPLATE });
    result.checklistTemplate = { ok: true, id: page.id };
  } catch (err) {
    result.checklistTemplate = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const page = await notion.pages.retrieve({ page_id: NOTION_PAGE_IDS.MARKET_CHECKLIST_ROOT });
    result.marketChecklistRoot = { ok: true, id: page.id };
  } catch (err) {
    result.marketChecklistRoot = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const db = await notion.databases.retrieve({ database_id: NOTION_PAGE_IDS.CALENDAR_DB });
    result.calendarDb = { ok: true, id: db.id, title: (db as { title?: { plain_text: string }[] }).title };
  } catch (err) {
    result.calendarDb = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return Response.json(result);
}
