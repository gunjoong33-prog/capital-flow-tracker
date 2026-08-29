// World Bank Documents & Reports API(WDS) — 공식 무료 API, 키 불필요. docty_exact로 "Economic
// Updates and Modeling"(정기 경제분석 리포트)만 필터링한다(전체 문서엔 대출계약서 등 리서치와
// 무관한 법률문서가 훨씬 많이 섞여 있음 — 실측 확인). Cloudflare가 커스텀 User-Agent를 봇으로
// 오탐(500)하는 걸 실측으로 확인해, broker-consensus.ts와 같은 일반 브라우저 UA를 쓴다.
const WDS_URL =
  "https://search.worldbank.org/api/v3/wds?format=json&rows=5&fl=docdt,display_title,pdfurl&os=0&docty_exact=Economic+Updates+and+Modeling&srt=docdt&order=desc";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (capital-flow-tracker personal use)";

export interface WorldBankReport {
  title: string;
  url: string;
  publishedAt: string;
}

interface WdsResponse {
  documents?: Record<string, { display_title?: string; pdfurl?: string; docdt?: string }>;
}

/** 최신 경제분석 리포트를 가져온다. 실패해도 던지지 않고 errors에 담는다. */
export async function fetchWorldBankReports(): Promise<{ reports: WorldBankReport[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch(WDS_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`World Bank WDS 조회 실패: ${res.status}`);
    const data = (await res.json()) as WdsResponse;
    const reports: WorldBankReport[] = [];
    for (const doc of Object.values(data.documents ?? {})) {
      if (!doc.display_title || !doc.pdfurl || !doc.docdt) continue;
      reports.push({ title: doc.display_title, url: doc.pdfurl, publishedAt: doc.docdt });
    }
    if (reports.length === 0) errors.push("World Bank: 파싱 결과 0건(응답 형식이 바뀌었을 수 있음)");
    return { reports, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { reports: [], errors };
  }
}
