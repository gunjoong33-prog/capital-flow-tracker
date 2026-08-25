-- AlterTable: 같은 sourceType+sourceName+date 조합의 ExternalConsensus 행이 매주 근중복으로
-- 쌓이는 것을 막는다(최종 리뷰 지적). 오케스트레이션 계층은 이후 create 대신 upsert를 쓴다.
CREATE UNIQUE INDEX "ExternalConsensus_sourceType_sourceName_date_key" ON "ExternalConsensus"("sourceType", "sourceName", "date");
