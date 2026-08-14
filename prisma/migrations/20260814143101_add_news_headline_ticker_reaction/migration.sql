-- CreateTable
CREATE TABLE "NewsHeadlineTicker" (
    "id" TEXT NOT NULL,
    "headlineId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "changePct" DOUBLE PRECISION,
    "asOfLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsHeadlineTicker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NewsHeadlineTicker_headlineId_idx" ON "NewsHeadlineTicker"("headlineId");

-- AddForeignKey
ALTER TABLE "NewsHeadlineTicker" ADD CONSTRAINT "NewsHeadlineTicker_headlineId_fkey" FOREIGN KEY ("headlineId") REFERENCES "NewsPageHeadline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
