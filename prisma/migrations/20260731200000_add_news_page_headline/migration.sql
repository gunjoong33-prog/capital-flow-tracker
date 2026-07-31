-- CreateTable
CREATE TABLE "NewsPageHeadline" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsPageHeadline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NewsPageHeadline_date_category_idx" ON "NewsPageHeadline"("date", "category");

-- CreateIndex
CREATE UNIQUE INDEX "NewsPageHeadline_date_category_url_key" ON "NewsPageHeadline"("date", "category", "url");
