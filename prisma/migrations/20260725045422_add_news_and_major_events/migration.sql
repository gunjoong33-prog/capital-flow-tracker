-- CreateTable
CREATE TABLE "NewsEvent" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MajorEvent" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "MajorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NewsEvent_date_idx" ON "NewsEvent"("date");

-- CreateIndex
CREATE INDEX "MajorEvent_date_idx" ON "MajorEvent"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MajorEvent_date_name_key" ON "MajorEvent"("date", "name");
