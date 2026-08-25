// BIS(국제결제은행) SDMX REST API — 완전 무료·공식, 중앙은행 공동기관 데이터라 특정 은행 편향이
// 없다. CSV 포맷으로 받아 컬럼을 정규식 없이 split만으로 파싱한다(JSON SDMX 구조가 더 복잡해서
// 이 코드베이스의 "안정적으로 단순한 형식 우선" 관례를 따름).
export interface PolicyRate {
  area: string; // "US" | "XM"(유로존) | "JP" 등 BIS 지역 코드
  period: string; // "YYYY-MM"
  ratePct: number;
}

const BIS_URL = "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/M.US+XM+JP?format=csv&lastNObservations=1";

/** 미국·유로존·일본 정책금리 최신 관측치를 가져온다. */
export async function fetchPolicyRates(): Promise<{ rates: PolicyRate[]; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetch(BIS_URL);
    if (!res.ok) throw new Error(`BIS API 조회 실패: ${res.status}`);
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    const header = lines[0]?.split(",") ?? [];
    const areaIdx = header.indexOf("REF_AREA");
    const periodIdx = header.indexOf("TIME_PERIOD");
    const valueIdx = header.indexOf("OBS_VALUE");
    if (areaIdx === -1 || periodIdx === -1 || valueIdx === -1) {
      errors.push("BIS: CSV 컬럼 구조가 예상과 다름(REF_AREA/TIME_PERIOD/OBS_VALUE 못 찾음)");
      return { rates: [], errors };
    }

    const rates: PolicyRate[] = [];
    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      const area = cols[areaIdx]?.trim();
      const period = cols[periodIdx]?.trim();
      const value = cols[valueIdx]?.trim();
      if (!area || !period || !value) continue;
      rates.push({ area, period, ratePct: Number(value) });
    }
    if (rates.length === 0) errors.push("BIS: 정책금리 파싱 결과 0건(응답 형식이 바뀌었을 수 있음)");

    return { rates, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { rates: [], errors };
  }
}
