-- CreateEnum
CREATE TYPE "ReleaseScheduleKind" AS ENUM ('INTERVAL', 'WEEKLY');

-- CreateEnum
CREATE TYPE "ReleaseEventKind" AS ENUM ('NEW_CHAPTER', 'UNLOCKED');

-- AlterTable
ALTER TABLE "Series" ADD COLUMN     "releaseAnchoredOn" TIMESTAMP(3),
ADD COLUMN     "releaseCadenceDays" INTEGER,
ADD COLUMN     "releaseEventKind" "ReleaseEventKind" NOT NULL DEFAULT 'NEW_CHAPTER',
ADD COLUMN     "releaseNote" TEXT,
ADD COLUMN     "releaseScheduleKind" "ReleaseScheduleKind",
ADD COLUMN     "releaseWeekdays" INTEGER[],
ADD COLUMN     "scheduleLastNotifiedAt" TIMESTAMP(3);
