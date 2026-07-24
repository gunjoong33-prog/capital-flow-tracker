import { Client } from "@notionhq/client";

// 노션 연동 — Checklist(397879da...)와 시장 체크리스트(3a0879da...) 페이지에
// 통합이 연결돼 있어야 조회·기록이 된다(페이지별로 개별 초대 필요, 이미 완료됨).
export const NOTION_PAGE_IDS = {
  CHECKLIST_TEMPLATE: "397879da3276806f85a5cd7de9b55177",
  MARKET_CHECKLIST_ROOT: "3a0879da3276836c8392016c53fcfb96",
  CALENDAR_DB: "69a879da327682a7a02901de9db5c368",
} as const;

export function getNotionClient() {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error("NOTION_TOKEN이 설정되지 않았다. .env에 넣어야 한다.");
  }
  return new Client({ auth: token });
}
