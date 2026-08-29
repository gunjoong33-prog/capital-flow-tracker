// 기관 리서치 원문 7개 소스(네이버·SEC·연준·ECB·World Bank·PIMCO·BlackRock)를 모아 저장하고
// 옵시디언에 내보내는 오케스트레이션. external-consensus.ts와 같은 원칙 — 모든 소스 모듈이
// 던지지 않고 errors를 반환하므로 이 계층에서 하나로 합친다.
//
// 설계 노트(기관 리서치 소스 조사 문서가 제안한 "일일 리포트 마크다운에 섹션 추가" 대신 별도
// 파일을 쓰는 이유): 이 소스들은 일일 리포트(매일 09:00 KST 확정)와 실행 시점·주기가 다르다
// (Fed·ECB는 매일 갱신되지만 PIMCO·BlackRock·World Bank는 주 단위). 매일 리포트 생성 함수 안에
// 엮으면 "그날 아직 새 리서치가 안 모였는데 리포트는 이미 나감" 같은 순서 문제가 생기고,
// exportDailyReportNow·buildDailyReportMarkdown(daily-report.ts가 의존, 169+ 테스트로 보호되는
// 공유 경로)를 건드리는 리그레션 위험도 커진다. 대신 이 모듈이 수집 직후 바로 자기 파일에 쓴다 —
// 옵시디언 "학습" 폴더(자기학습 기능이 이미 쓰는 것과 같은 트리) 밑에 수집일자별로 쌓인다.
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { fetchNaverResearch } from "@/lib/sources/naver-research";
import { fetchBigTech8KExcerpts } from "@/lib/sources/sec-filings-text";
import { fetchFedReleases } from "@/lib/sources/fed-releases";
import { fetchEcbPublications } from "@/lib/sources/ecb-publications";
import { fetchWorldBankReports } from "@/lib/sources/world-bank";
import { fetchPimcoOutlooks } from "@/lib/sources/pimco";
import { fetchBlackrockCommentary } from "@/lib/sources/blackrock";
import { upsertObsidianFile } from "@/lib/obsidian-export";

const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;

interface CollectedItem {
  sourceType: string;
  sourceName: string;
  title: string;
  url: string;
  extra?: string; // 표시용 부가정보(발행일·증권사명 등)
}

export async function collectInstitutionalResearch(): Promise<{ saved: number; items: CollectedItem[]; errors: string[] }> {
  const errors: string[] = [];
  const items: CollectedItem[] = [];
  const today = new Date();

  const naver = await fetchNaverResearch(10);
  errors.push(...naver.errors);
  for (const r of naver.items) {
    items.push({ sourceType: "naver_research", sourceName: `${r.broker}:${r.title}`, title: `[${r.broker}] ${r.title}`, url: r.pdfUrl ?? "", extra: r.stockName });
  }

  const sec = await fetchBigTech8KExcerpts();
  errors.push(...sec.errors);
  for (const e of sec.excerpts) {
    items.push({ sourceType: "sec_8k", sourceName: e.ticker, title: `${e.ticker} 8-K(${e.filingDate})`, url: e.url, extra: e.excerpt });
  }

  const fed = await fetchFedReleases(5);
  errors.push(...fed.errors);
  for (const r of fed.releases) {
    items.push({ sourceType: "fed", sourceName: r.url, title: r.title, url: r.url, extra: r.kind });
  }

  const ecb = await fetchEcbPublications(5);
  errors.push(...ecb.errors);
  for (const p of ecb.publications) {
    items.push({ sourceType: "ecb", sourceName: p.url, title: p.title, url: p.url });
  }

  const worldBank = await fetchWorldBankReports();
  errors.push(...worldBank.errors);
  for (const r of worldBank.reports) {
    items.push({ sourceType: "world_bank", sourceName: r.url, title: r.title, url: r.url, extra: r.publishedAt });
  }

  const pimco = await fetchPimcoOutlooks();
  errors.push(...pimco.errors);
  for (const o of pimco.outlooks) {
    items.push({ sourceType: "pimco", sourceName: o.label, title: `PIMCO ${o.label}`, url: o.url });
  }

  const blackrock = await fetchBlackrockCommentary();
  errors.push(...blackrock.errors);
  if (blackrock.commentary) {
    items.push({ sourceType: "blackrock", sourceName: "weekly-commentary", title: blackrock.commentary.title, url: blackrock.commentary.url });
  }

  let saved = 0;
  for (const item of items) {
    await db.externalConsensus.upsert({
      where: { sourceType_sourceName_date: { sourceType: item.sourceType, sourceName: item.sourceName, date: today } },
      create: { sourceType: item.sourceType, sourceName: item.sourceName, date: today, payload: asJson(item) },
      update: { payload: asJson(item) },
    });
    saved++;
  }

  return { saved, items, errors };
}

const SOURCE_LABEL: Record<string, string> = {
  naver_research: "국내 증권사(네이버금융)",
  sec_8k: "SEC 8-K 공시",
  fed: "미 연준(Fed)",
  ecb: "ECB",
  world_bank: "World Bank",
  pimco: "PIMCO",
  blackrock: "BlackRock",
};

export function buildInstitutionalResearchMarkdown(dateStr: string, items: CollectedItem[]): string {
  let md = `# ${dateStr} 오늘의 기관 리서치 원문\n\n`;
  if (items.length === 0) {
    md += "수집된 항목이 없습니다.\n";
    return md;
  }
  const bySource = new Map<string, CollectedItem[]>();
  for (const item of items) {
    if (!bySource.has(item.sourceType)) bySource.set(item.sourceType, []);
    bySource.get(item.sourceType)!.push(item);
  }
  for (const [sourceType, sourceItems] of bySource) {
    md += `## ${SOURCE_LABEL[sourceType] ?? sourceType}\n\n`;
    for (const item of sourceItems) {
      md += `- [${item.title}](${item.url || "#"})`;
      if (item.extra) md += ` — ${item.extra.length > 200 ? `${item.extra.slice(0, 200)}...` : item.extra}`;
      md += "\n";
    }
    md += "\n";
  }
  return md;
}

/** 수집 + DB 저장 + 옵시디언 파일 작성까지 한 번에 한다. */
export async function collectAndExportInstitutionalResearch(): Promise<{ saved: number; errors: string[] }> {
  const { saved, items, errors } = await collectInstitutionalResearch();

  const token = process.env.GITHUB_EXPORT_TOKEN;
  if (token && items.length > 0) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const repoPath = `obsidian-export/학습/기관 리서치/${dateStr}.md`;
    const { status, detail } = await upsertObsidianFile(repoPath, buildInstitutionalResearchMarkdown(dateStr, items), token);
    if (status === "error") errors.push(`옵시디언 export 실패: ${repoPath}${detail ? ` (${detail})` : ""}`);
  }

  return { saved, errors };
}
