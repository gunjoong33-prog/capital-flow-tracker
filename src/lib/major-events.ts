import { db } from "@/lib/db";
import { kstDateString } from "@/lib/date";

// FOMC 회의 결과 발표일 — 연준이 매년 미리 공개하는 고정 일정(federalreserve.gov/monetarypolicy/fomccalendars.htm).
// FRED에는 이 일정을 위한 release_id가 없어(확인함, release 101 "FOMC Press Release"는 확정된 미래 날짜를
// 안 돌려줌) 직접 갱신해야 한다 — 다음 해 일정이 공개되면(보통 그 전해 하반기) 이 목록에 추가할 것.
// 2일 회의 중 정책 발표가 나오는 둘째 날 날짜를 썼다.
const FOMC_DATES_2026 = [
  "2026-01-28",
  "2026-03-18",
  "2026-04-29",
  "2026-06-17",
  "2026-07-29",
  "2026-09-16",
  "2026-10-28",
  "2026-12-09",
];

// 일본은행 금융정책결정회의(BOJ Monetary Policy Meeting) — 일본은행이 매년 미리 공개하는 고정
// 일정(boj.or.jp, "Scheduled Dates of Monetary Policy Meetings in 2026" PDF, 2025-07-31 발표분
// 기준). 이틀짜리 회의라 FOMC와 같은 원칙으로 정책 발표가 나오는 둘째 날 날짜를 썼다.
const BOJ_DATES_2026 = [
  "2026-01-23",
  "2026-03-19",
  "2026-04-28",
  "2026-06-16",
  "2026-07-31",
  "2026-09-18",
  "2026-10-30",
  "2026-12-18",
];

const FRED_RELEASES: { id: number; name: string }[] = [
  { id: 10, name: "미국 CPI 발표" },
  { id: 50, name: "미국 고용지표 발표" },
  { id: 46, name: "미국 PPI 발표" },
  { id: 54, name: "미국 PCE 물가지표 발표" },
];

async function fetchFredReleaseDatesForYear(releaseId: number, apiKey: string, year: number): Promise<string[]> {
  // realtime_start/end가 "오늘"이나 해를 넘는 넓은 범위면 빈 배열/일부만 돌아온다(실측 확인함) —
  // 연초~연말로 딱 맞춰 조회해야 한다. include_release_dates_with_no_data=true도 필수 —
  // false면 "이미 데이터가 발표된" 과거 날짜만 오고, 아직 안 온 미래 예정일은 빠진다(실측 확인함).
  const url = `https://api.stlouisfed.org/fred/release/dates?release_id=${releaseId}&api_key=${apiKey}&file_type=json&realtime_start=${year}-01-01&realtime_end=${year}-12-31&include_release_dates_with_no_data=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED release ${releaseId} 조회 실패: ${res.status}`);
  const data = (await res.json()) as { release_dates?: { date: string }[] };
  return (data.release_dates ?? []).map((d) => d.date);
}

/** 올해 + 내년(공개돼 있으면) 발표일을 합쳐서 반환. 내년 일정 미공개 시 빈 배열이 와도 무시한다. */
async function fetchFredReleaseDates(releaseId: number, apiKey: string): Promise<string[]> {
  const year = new Date().getFullYear();
  const [thisYear, nextYear] = await Promise.all([
    fetchFredReleaseDatesForYear(releaseId, apiKey, year),
    fetchFredReleaseDatesForYear(releaseId, apiKey, year + 1).catch(() => []),
  ]);
  return [...thisYear, ...nextYear];
}

/**
 * FOMC·BOJ(고정 목록) + CPI/고용지표(FRED 실시간 조회) 발표일을 MajorEvent 테이블에 동기화.
 * 매일 파이프라인에서 한 번 호출 — 캘린더 UI와 1단계 "14일 내 큰 이벤트" 판정이 여기서 읽어간다.
 */
export async function syncMajorEvents(): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  const rows: { date: string; name: string; source: string }[] = [];

  for (const date of FOMC_DATES_2026) {
    rows.push({ date, name: "FOMC 회의 결과 발표", source: "fed" });
  }

  for (const date of BOJ_DATES_2026) {
    rows.push({ date, name: "일본금융정책결정회의(BOJ 금리 결정)", source: "boj" });
  }

  const fredKey = process.env.FRED_API_KEY;
  if (fredKey) {
    for (const release of FRED_RELEASES) {
      try {
        const dates = await fetchFredReleaseDates(release.id, fredKey);
        for (const date of dates) rows.push({ date, name: release.name, source: "fred" });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  } else {
    errors.push("FRED_API_KEY 없음 — CPI/PPI/PCE/고용지표 일정 동기화 스킵");
  }

  let synced = 0;
  for (const row of rows) {
    await db.majorEvent.upsert({
      where: { date_name: { date: new Date(row.date), name: row.name } },
      create: { date: new Date(row.date), name: row.name, source: row.source },
      update: {},
    });
    synced++;
  }

  return { synced, errors };
}

/** asOf(기본 "지금")을 KST 기준 오늘로 변환해 그날부터 days일 뒤까지를 조회한다. 예전엔
 * new Date()+setUTCHours로 직접 UTC 자정을 잡아서, KST 0~9시(9시 파이프라인 실행 시각과 겹침)
 * 사이엔 하루 이른 날짜를 "오늘"로 잘못 계산했다(event-outcomes.ts에서 이미 한 번 겪은 것과
 * 같은 KST 경계 버그 클래스, 코드 감사로 발견 — 자매 함수 getMajorEventsInRange는 처음부터
 * asOf를 그대로 받아 이 문제가 없었다). */
export async function getUpcomingMajorEvents(days: number, asOf: Date = new Date()) {
  const today = new Date(`${kstDateString(asOf)}T00:00:00Z`);
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + days);
  return db.majorEvent.findMany({
    where: { date: { gte: today, lte: end } },
    orderBy: { date: "asc" },
  });
}

export async function getMajorEventsInRange(start: Date, end: Date) {
  return db.majorEvent.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
  });
}
