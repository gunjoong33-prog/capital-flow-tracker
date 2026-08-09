// 섹터 5일 수익률·전일 대비·거래량 배율 계산 — yahoo.ts(주 소스)와 alphavantage.ts(폴백)가
// 데이터를 가져오는 방식은 다르지만(Yahoo는 당일 진행 중인 봉을 트리밍해야 하고, Alpha Vantage
// TIME_SERIES_DAILY는 완결된 봉만 준다) 정렬된 closes/volumes 배열을 받은 다음의 계산식 자체는
// 완전히 같았다 — 두 파일에 거의 그대로 복붙돼 있어서(코드 감사로 발견) 나중에 계산식을 고치면
// 한쪽만 고치고 다른 쪽을 빠뜨릴 위험이 있었다. 여기 하나로 합친다.
export function computeSectorMetrics(
  closes: number[],
  volumes: number[]
): { return5d: number; changePct1d: number; volumeRatio: number } {
  const last = closes.length;
  const close5dAgo = closes[Math.max(0, last - 6)];
  const closeLatest = closes[last - 1];
  const closePrevDay = closes[Math.max(0, last - 2)];
  const return5d = ((closeLatest - close5dAgo) / close5dAgo) * 100;
  const changePct1d = ((closeLatest - closePrevDay) / closePrevDay) * 100;

  // 당일(recentVolume) 자신을 20일 평균의 분모에 포함시키면 안 된다 — "오늘 거래량이 최근 평균보다
  // 몇 배인가"를 재는 지표인데 오늘 값이 자기 자신을 재는 기준에 섞여 들어가면 배수가 구조적으로
  // 항상 낮게(자기 자신 쪽으로 쏠리며) 나온다. 당일 이전 20봉만으로 평균을 낸다.
  const recentVolume = volumes[volumes.length - 1];
  const priorVolumes = volumes.slice(0, -1).slice(-20);
  const avgVolume20d = priorVolumes.reduce((sum, v) => sum + v, 0) / priorVolumes.length;
  const volumeRatio = recentVolume / avgVolume20d;

  return { return5d, changePct1d, volumeRatio };
}
