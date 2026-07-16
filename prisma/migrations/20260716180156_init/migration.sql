-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SeriesStatus" AS ENUM ('READING', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('FEED', 'PAGE_WATCH');

-- CreateEnum
CREATE TYPE "SourceMatch" AS ENUM ('WHOLE_FEED', 'CATEGORY', 'PATH_PREFIX');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('ZH', 'KO', 'JA', 'EN', 'OTHER');

-- CreateEnum
CREATE TYPE "AccessState" AS ENUM ('FREE', 'LOCKED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SourceHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'LIKELY_DOWN');

-- CreateEnum
CREATE TYPE "FailureType" AS ENUM ('NONE', 'DNS', 'TIMEOUT', 'HTTP_4XX', 'HTTP_5XX', 'PARKED', 'TLS');

-- CreateEnum
CREATE TYPE "TranslationStatus" AS ENUM ('ONGOING', 'STALLED', 'COMPLETE', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Series" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "canonicalId" TEXT,
    "language" "Language" NOT NULL DEFAULT 'OTHER',
    "status" "SeriesStatus" NOT NULL DEFAULT 'READING',
    "rating" INTEGER,
    "notes" TEXT,
    "tags" TEXT[],
    "coverUrl" TEXT,
    "finishedAt" TIMESTAMP(3),
    "targetChapterCount" INTEGER,
    "translationStatus" "TranslationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "type" "SourceType" NOT NULL DEFAULT 'FEED',
    "feedUrl" TEXT,
    "matchType" "SourceMatch" NOT NULL DEFAULT 'WHOLE_FEED',
    "matchValue" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "health" "SourceHealth" NOT NULL DEFAULT 'HEALTHY',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "failureScore" INTEGER NOT NULL DEFAULT 0,
    "lastFailureType" "FailureType" NOT NULL DEFAULT 'NONE',
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "etag" TEXT,
    "lastModified" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "number" DOUBLE PRECISION,
    "url" TEXT NOT NULL,
    "guid" TEXT,
    "publishedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "access" "AccessState" NOT NULL DEFAULT 'UNKNOWN',
    "becameFreeAt" TIMESTAMP(3),

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadingProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "lastReadChapterId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Series_userId_status_idx" ON "Series"("userId", "status");

-- CreateIndex
CREATE INDEX "Series_userId_canonicalId_idx" ON "Series"("userId", "canonicalId");

-- CreateIndex
CREATE INDEX "Source_seriesId_idx" ON "Source"("seriesId");

-- CreateIndex
CREATE INDEX "Source_host_idx" ON "Source"("host");

-- CreateIndex
CREATE INDEX "Chapter_seriesId_idx" ON "Chapter"("seriesId");

-- CreateIndex
CREATE INDEX "Chapter_sourceId_idx" ON "Chapter"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_seriesId_url_key" ON "Chapter"("seriesId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingProgress_seriesId_key" ON "ReadingProgress"("seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingProgress" ADD CONSTRAINT "ReadingProgress_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

