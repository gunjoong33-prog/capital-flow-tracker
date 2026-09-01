import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchKcmiReports, parseKcmiJson } from "./kcmi-report";

// 픽스처는 2026-09-01 실측 kcmi.re.kr/report/json_report_list 응답 구조를 그대로 축약함.
const JSON_BODY = [
  {
    report_no: "2319",
    report_title: "무형자산의 부상과 생산요소의 배분 효율성",
    pub_date: "2026.08.26",
    report_pdf_download_link: "/common/downloadw?fid=29133&fgu=002002&fty=004003",
    report_subject_name: "거시금융",
  },
  {
    report_no: "2315",
    report_title: "주식시장 변동성 상승의 배경 검토",
    pub_date: "2026.07.27",
    report_pdf_download_link: "/common/downloadw?fid=29074&fgu=002002&fty=004003",
    report_subject_name: "자본시장",
  },
];

describe("parseKcmiJson", () => {
  it("리포트 배열을 파싱해 PDF 링크를 절대경로로 반환한다", () => {
    const reports = parseKcmiJson(JSON_BODY);

    expect(reports).toHaveLength(2);
    expect(reports[0]).toEqual({
      title: "무형자산의 부상과 생산요소의 배분 효율성",
      url: "https://www.kcmi.re.kr/common/downloadw?fid=29133&fgu=002002&fty=004003",
      publishedAt: "2026.08.26",
      subject: "거시금융",
    });
  });

  it("배열이 아니면 빈 배열을 반환한다", () => {
    expect(parseKcmiJson({ error: true })).toEqual([]);
  });

  it("필수 필드가 없는 항목은 제외한다", () => {
    expect(parseKcmiJson([{ report_title: "제목만 있음" }])).toEqual([]);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchKcmiReports", () => {
  it("최신 리포트를 가져온다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON_BODY) } as Response)));

    const { reports, errors } = await fetchKcmiReports(4);

    expect(errors).toEqual([]);
    expect(reports).toHaveLength(2);
  });

  it("HTTP 실패 시 던지지 않고 errors에 담는다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve([]) } as Response)));

    const { reports, errors } = await fetchKcmiReports();

    expect(reports).toEqual([]);
    expect(errors[0]).toContain("자본시장연구원 리포트 조회 실패");
  });
});
