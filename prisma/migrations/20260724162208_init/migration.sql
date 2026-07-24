-- CreateTable
CREATE TABLE "MetricValue" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "step1" JSONB NOT NULL,
    "step2" JSONB NOT NULL,
    "step3" JSONB NOT NULL,
    "step4" JSONB NOT NULL,
    "step5" JSONB NOT NULL,
    "step6" JSONB NOT NULL,
    "step7" JSONB NOT NULL,
    "step8" JSONB NOT NULL,
    "narrative" TEXT,
    "dataCompleteness" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodReport" (
    "id" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "summary" JSONB NOT NULL,
    "narrative" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeriodReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualInputLog" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualInputLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetricValue_metric_date_idx" ON "MetricValue"("metric", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MetricValue_metric_date_key" ON "MetricValue"("metric", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_date_key" ON "DailyReport"("date");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodReport_periodType_periodStart_key" ON "PeriodReport"("periodType", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "ManualInputLog_metric_date_key" ON "ManualInputLog"("metric", "date");
