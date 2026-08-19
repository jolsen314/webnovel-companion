-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'API';

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "apiMap" JSONB,
ADD COLUMN     "apiUrl" TEXT;
