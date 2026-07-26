-- CreateTable
CREATE TABLE "NotificationPrefs" (
    "userId" TEXT NOT NULL,
    "pushNewChapter" BOOLEAN NOT NULL DEFAULT true,
    "pushScheduled" BOOLEAN NOT NULL DEFAULT true,
    "pushSourceDown" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPrefs_pkey" PRIMARY KEY ("userId")
);
