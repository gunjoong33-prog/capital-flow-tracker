# 자산배분 가이드(5개 자산군) — 설계 문서

**배경**: 아티팩트("자가학습 운영 일지") "남은 과제" 3번 — 원 요청의 두 하위 프로젝트(자산배분 가이드, 자금흐름 예측) 중 첫 번째. 사용자가 "재요청 전 착수 금지"로 보류해뒀던 항목을 명시적으로 재요청해 진행.

## 배경 조사로 확인한 사실

`scoring/pure.ts`에 이미 `positionSizePct`(매수 시 진입 비중)와 `cashAllocationPct`(현금비중늘리기 시 현금화 비중)가 구현돼 있었다 — "위험자산 vs 안전자산" 이분법은 이미 존재. 다만 요청한 5개 자산군(주식·코인·채권·부동산·현금) 중 코인은 step5(NDX/RUT vs BTC/ETH 20일 수익률)에 실제 신호가 있지만, **채권·부동산은 이 사이트에 신호 자체가 없다.**

## 설계 결정 (사용자와 합의)

1. 출력 형태: 숫자 비중(%) + 근거 서술 (방향성만 서술하는 안은 기각)
2. 기존 positionSizePct/cashAllocationPct를 뼈대로 5개 자산군까지 세분화(둘만 노출하는 안은 기각)
3. 신호 없는 채권·부동산: 고정 비율로만 배분(부동산은 신호 없음을 명시하고 0%)

## 계산 로직 (전부 `scoring/pure.ts`의 고정 규칙, LLM 관여 없음)

```
1단계 — 위험자산(riskPct) vs 안전자산(safePct) 총 비중
  · 매수        → riskPct = positionSizePct
  · 지켜보기     → riskPct = 50(고정, RISK_PCT_WATCH — positionSizePct/cashAllocationPct 둘 다 null이라)
  · 현금비중늘리기 → riskPct = 100 - cashAllocationPct

2단계 — 위험자산 내부: 주식 vs 코인 (step5.coinMomentumHigherThanStock 기준)
  · (BTC+ETH)/2 20일 수익률 > (NDX+RUT)/2 20일 수익률 → 코인 15%(COIN_SHARE_OF_RISK_HIGH), 주식 85%
  · 그 외(약하거나 코인 데이터 없음) → 코인 5%(COIN_SHARE_OF_RISK_LOW), 주식 95%

3단계 — 안전자산 내부: 현금 vs 채권 (고정)
  · 채권 30%(BOND_SHARE_OF_SAFE), 현금 70%

부동산: 항상 0% — "분석 결과 0%"가 아니라 "다룰 데이터가 없다"는 뜻, UI에 그대로 명시.
```

모든 상수는 `scoring/pure.ts`에 이름 붙은 상수로 노출되고 테스트로 고정된다(`pure.test.ts`의 `assetAllocation` describe 블록). 반올림으로 합이 100에서 ±1 벗어날 수 있으나(기존 `positionSizePct`와 같은 관례), 정밀 계기가 아니라 참고용 가이드라 감수한다.

## 구현

- `scoring/types.ts`: `Step5Result.coinMomentumHigherThanStock: boolean | null` 추가, `Step8Result.assetAllocation: AssetAllocation` 추가, `AssetAllocation` 인터페이스 신규.
- `scoring/pure.ts`: `scoreStep5()`가 `coinMomentumHigherThanStock` 계산, `scoreStep8()`이 새 `computeAssetAllocation()` 헬퍼 호출.
- `scoring/run.ts`: `details.step8` 배열(기존 UI 상세 표)에 "자산배분 가이드" 행 1개 추가 — 새 컴포넌트·페이지 없이 기존 8단계 표에 그대로 노출.

## 범위 밖

- LLM 서술(왜 이 비율인지 narrative에 반영)은 이번 범위에 포함하지 않음 — 고정 규칙 자체가 이미 표 안의 `criterion` 열에 투명하게 노출되므로, 별도 LLM 문장 없이도 "왜 이런지"가 표에서 바로 보인다. 필요하면 후속 작업으로 추가.
- 자금흐름 예측(원 요청의 두 번째 하위 프로젝트)은 별도 설계 문서로 진행.
- 채권·부동산에 대한 실제 데이터 신호 확보(새 소스 조사)는 이번 범위 밖.

## 테스트

`pure.test.ts`에 `coinMomentumHigherThanStock` 3개 케이스(코인 강세/약세/데이터없음) + `assetAllocation` 5개 케이스(매수+코인강세, 매수+코인데이터없음, 현금비중늘리기, 지켜보기, 부동산 항상 0) 추가. 272/272 테스트, tsc clean.
