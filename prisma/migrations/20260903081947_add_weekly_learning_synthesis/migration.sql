-- CreateTable
CREATE TABLE "WeeklyLearningSynthesis" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyLearningSynthesis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyLearningSynthesis_periodKey_key" ON "WeeklyLearningSynthesis"("periodKey");
