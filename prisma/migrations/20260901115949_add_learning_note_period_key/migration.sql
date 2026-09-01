-- 2026-09-01: 같은 소스가 같은 주에 여러 번 distill되며 근중복 행이 11건 쌓인 버그를
-- 잡는다. 이 마이그레이션 하나로 (1) 기존 중복 정리 (2) 재발 방지 제약 추가를 함께 한다.

-- Step 1: nullable로 컬럼 추가 (기존 42개 행이 있어 NOT NULL로 바로는 못 넣는다)
ALTER TABLE "LearningNote" ADD COLUMN "periodKey" TEXT;

-- Step 2: 기존 행 전부 ISO 주차 키로 백필. TO_CHAR의 IYYY/IW는 ISO 8601 주차 계산(목요일 기준)을
-- 그대로 구현하므로, 이후 애플리케이션 코드(learning-distill.ts)의 JS 계산과 결과가 일치한다.
UPDATE "LearningNote" SET "periodKey" = TO_CHAR("createdAt", 'IYYY"-W"IW');

-- Step 3: 같은 (sourceName, periodKey) 조합이 여러 행이면 가장 최신 것만 남기고 나머지는 삭제
-- (부분 실행 후 전체 재실행이 겹쳐 생긴 근중복 — 최신 행이 더 완전한 데이터를 담고 있다).
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "sourceName", "periodKey"
    ORDER BY "createdAt" DESC, "id" DESC
  ) AS rn
  FROM "LearningNote"
)
DELETE FROM "LearningNote"
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

-- Step 4: 이제 중복이 없으니 NOT NULL로 강제
ALTER TABLE "LearningNote" ALTER COLUMN "periodKey" SET NOT NULL;

-- Step 5: 재발 방지 — 같은 소스를 같은 주에 다시 distill하면 새 행 대신 upsert로 덮어쓰도록
-- 유니크 제약 추가. 오케스트레이션 계층(learning-distill.ts)은 이후 create 대신 upsert를 쓴다.
CREATE UNIQUE INDEX "LearningNote_sourceName_periodKey_key" ON "LearningNote"("sourceName", "periodKey");
