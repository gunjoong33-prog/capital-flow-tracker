-- CreateTable
CREATE TABLE "ExternalConsensus" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalConsensus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningNote" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "basedOn" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoFixLog" (
    "id" TEXT NOT NULL,
    "detectedIssue" TEXT NOT NULL,
    "attemptedFix" TEXT,
    "testsPassed" BOOLEAN,
    "protectedFileTouched" BOOLEAN,
    "deployed" BOOLEAN NOT NULL DEFAULT false,
    "prUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutoFixLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalConsensus_sourceType_date_idx" ON "ExternalConsensus"("sourceType", "date");

-- CreateIndex
CREATE INDEX "LearningNote_category_sourceName_idx" ON "LearningNote"("category", "sourceName");

-- CreateIndex
CREATE INDEX "AutoFixLog_createdAt_idx" ON "AutoFixLog"("createdAt");
