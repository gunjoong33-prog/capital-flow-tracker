import { getNotionClient } from "@/lib/notion";

// 11개 하위 DB (재구성 완료 — 전부 "날짜" 속성 추가됨, 이제부턴 템플릿 복제가 아니라
// 매일 새 행을 추가하는 방식으로 기록한다).
const DB = {
  지정학및정책: "397879da-3276-8036-9828-d3c555f2feec",
  국내유동성: "397879da-3276-8019-a19a-c8799ec865e8",
  FRED지표: "397879da-3276-8019-9a6c-e644003fc966",
  US10Y_JP10Y: "397879da-3276-807f-931d-e63c40c7ffbb",
  유가: "397879da-3276-805b-b5fa-db8cf83948f8",
  실물자산: "397879da-3276-8048-86a2-d4cdd10da8ec",
  환율: "397879da-3276-803c-a989-f8da704a5e87",
  주요주가지수: "397879da-3276-80f9-8c15-c7bbdc06acd7",
  섹터별자금: "3a4879da-3276-80dd-93a5-d9c8e77c0349",
  대형투자자: "397879da-3276-80c6-9b95-dd9722c4432d",
  공포와탐욕: "397879da-3276-8094-8aa3-c71bc7b7e007",
} as const;

type NotionClient = ReturnType<typeof getNotionClient>;

function dateProp(dateIso: string) {
  return { date: { start: dateIso } };
}
function titleProp(text: string) {
  return { title: [{ text: { content: text } }] };
}
function textProp(text: string) {
  return { rich_text: [{ text: { content: text.slice(0, 2000) } }] };
}
function urlProp(url: string | null) {
  return { url };
}
function checkboxProp(checked: boolean) {
  return { checkbox: checked };
}

async function addRow(
  notion: NotionClient,
  databaseId: string,
  properties: Record<string, unknown>
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: properties as any,
  });
  return page.id;
}

export interface DailyNotionInput {
  date: string; // YYYY-MM-DD
  geopolitics: { summary: string; link: string | null; risky: boolean };
  domesticLiquidity: { name: string; condition: string; status: string }[];
  fredIndicators: { name: string; condition: string; status: string; qualifies: boolean }[];
  carryTrade: { spreadBp: number; change: string; status: string };
  oil: { name: string; priceChange: string; status: string }[]; // WTI, 브렌트
  gold: { priceChange: string; status: string };
  fx: { name: string; priceChange: string; status: string }[]; // USD/KRW, USD/JPY
  indices: {
    name: string;
    close: string;
    dayChange: string;
    prevChange: string;
    ytdChange: string;
  }[]; // NDX, RUT, DJI, SPX, BTC, ETH
  sectors: { name: string; return: string; note: string }[];
  smartMoney: { name: string; note: string }[]; // WhaleWisdom, Folioobs, 비트코인ETF흐름
  sentiment: { name: string; cause: string }[]; // CNN F&G, VIX
}

/** 오늘자 체크리스트 결과를 노션 11개 하위 DB에 전부 기록한다. 생성된 페이지 ID를 전부 반환(정리·추적용). */
export async function writeDailyChecklistToNotion(input: DailyNotionInput) {
  const notion = getNotionClient();
  const d = input.date;
  const pageIds: string[] = [];

  pageIds.push(
    await addRow(notion, DB.지정학및정책, {
      "지정학 및 정책": titleProp(input.geopolitics.summary.slice(0, 100)),
      내용: textProp(input.geopolitics.summary),
      "바로 가기": urlProp(input.geopolitics.link),
      "": checkboxProp(input.geopolitics.risky),
      날짜: dateProp(d),
    })
  );

  for (const item of input.domesticLiquidity) {
    pageIds.push(
      await addRow(notion, DB.국내유동성, {
        "유동성 지표": titleProp(item.name),
        "투자 체크리스트 조건": textProp(item.condition),
        "상태 및 기준 판단": textProp(item.status),
        날짜: dateProp(d),
      })
    );
  }

  for (const item of input.fredIndicators) {
    pageIds.push(
      await addRow(notion, DB.FRED지표, {
        지표: titleProp(item.name),
        체크박스: checkboxProp(item.qualifies),
        "투자 체크포인트 조건": textProp(item.condition),
        "상태 및 기준 판단": textProp(item.status),
        날짜: dateProp(d),
      })
    );
  }

  pageIds.push(
    await addRow(notion, DB.US10Y_JP10Y, {
      "US10Y-JP10Y": titleProp(`${input.carryTrade.spreadBp}bp`),
      변동: textProp(input.carryTrade.change),
      "상태 및 기준 판단": textProp(input.carryTrade.status),
      날짜: dateProp(d),
    })
  );

  for (const item of input.oil) {
    pageIds.push(
      await addRow(notion, DB.유가, {
        "3대 유종": titleProp(item.name),
        "종가/변동액/변동률": textProp(item.priceChange),
        "상태 및 분석": textProp(item.status),
        날짜: dateProp(d),
      })
    );
  }

  pageIds.push(
    await addRow(notion, DB.실물자산, {
      실물자산: titleProp("금"),
      "종가/변동액/변동률": textProp(input.gold.priceChange),
      "상태 및 분석": textProp(input.gold.status),
      날짜: dateProp(d),
    })
  );

  for (const item of input.fx) {
    pageIds.push(
      await addRow(notion, DB.환율, {
        화폐: titleProp(item.name),
        "종가/변동액/변동률": textProp(item.priceChange),
        "상태 및 분석": textProp(item.status),
        날짜: dateProp(d),
      })
    );
  }

  for (const item of input.indices) {
    pageIds.push(
      await addRow(notion, DB.주요주가지수, {
        "주요 주가지수": titleProp(item.name),
        "마감 지수 (p)": textProp(item.close),
        "일간 등락률(%)": textProp(item.dayChange),
        "전일 대비 변동폭": textProp(item.prevChange),
        "연초 대비 등락률(%)": textProp(item.ytdChange),
        날짜: dateProp(d),
      })
    );
  }

  for (const item of input.sectors) {
    pageIds.push(
      await addRow(notion, DB.섹터별자금, {
        섹터: titleProp(item.name),
        등락률: textProp(item.return),
        "자본의 이동 및 근거": textProp(item.note),
        날짜: dateProp(d),
      })
    );
  }

  for (const item of input.smartMoney) {
    pageIds.push(
      await addRow(notion, DB.대형투자자, {
        대형투자자: titleProp(item.name),
        "변동 및 분석 일치 확인": textProp(item.note),
        날짜: dateProp(d),
      })
    );
  }

  for (const item of input.sentiment) {
    pageIds.push(
      await addRow(notion, DB.공포와탐욕, {
        지수: titleProp(item.name),
        "변동 원인": textProp(item.cause),
        날짜: dateProp(d),
      })
    );
  }

  return { pageIds, count: pageIds.length };
}

/** 페이지들을 휴지통으로 보낸다(테스트 데이터 정리용). */
export async function archiveNotionPages(pageIds: string[]) {
  const notion = getNotionClient();
  for (const id of pageIds) {
    await notion.pages.update({ page_id: id, archived: true });
  }
}
