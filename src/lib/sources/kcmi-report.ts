// 자본시장연구원(KCMI) 연구보고서 — 로그인·키 불필요(robots.txt: Allow: /, 실측 확인 2026-09).
// 목록 페이지(/report/report_list) 자체는 Handlebars 템플릿 뼈대만 서버 렌더링되고 실제 데이터는
// 이 JSON API(/report/json_report_list)가 채운다 — 페이지 안의 cf-turnstile은 리포트 목록과 무관한
// 별도 "저자 연락처" 팝업 전용이라 이 API 호출과는 상관없다(실측 확인, Referer·인증 불필요).
const JSON_LIST_URL = "https://www.kcmi.re.kr/report/json_report_list";
const USER_AGENT = "Mozilla/5.0 (capital-flow-tracker personal use)";

export interface KcmiReport {
  title: string;
  url: string;
  publishedAt: string;
  subject: string; // report_subject_name(예: "거시금융")
}

interface KcmiJsonItem {
  report_title?: string;
  pub_date?: string;
  report_pdf_download_link?: string;
  report_subject_name?: string;
}

/** JSON 응답 배열을 파싱한다. */
export function parseKcmiJson(data: unknown): KcmiReport[] {
  if (!Array.isArray(data)) return [];
  const reports: KcmiReport[] = [];
  for (const item of data as KcmiJsonItem[]) {
    if (!item.report_title || !item.pub_date || !item.report_pdf_download_link) continue;
    reports.push({
      title: item.report_title,
      url: `https://www.kcmi.re.kr${item.report_pdf_download_link}`,
      publishedAt: item.pub_date,
      subject: item.report_subject_name ?? "",
    });
  }
  return reports;
}

/** 최신 연구보고서 상위 limit건을 가져온다. 실패해도 던지지 않고 errors에 담는다. */
export async function fetchKcmiReports(limit = 4): Promise<{ reports: KcmiReport[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch(JSON_LIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: `thispage=1&perpage=${limit}&s_report_subject=&s_report_type=`,
    });
    if (!res.ok) throw new Error(`자본시장연구원 리포트 조회 실패: ${res.status}`);
    const reports = parseKcmiJson(await res.json());
    if (reports.length === 0) errors.push("자본시장연구원: 파싱 결과 0건(응답 형식이 바뀌었을 수 있음)");
    return { reports, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { reports: [], errors };
  }
}
