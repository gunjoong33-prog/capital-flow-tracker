-- 같은 미국장 거래일이 두 행에 들어가면 적중률 분모가 그 하루를 두 번 센다(7/31·8/1 실제 사례).
-- 파이프라인의 "휴장일 스킵" 가드는 직전 1건만 비교하므로 DB 레벨 방어를 추가한다.
-- Postgres는 NULL을 유일성 검사에서 제외하므로 marketDate 미기록 행은 영향받지 않는다.
CREATE UNIQUE INDEX "DailyReport_marketDate_key" ON "DailyReport"("marketDate");
