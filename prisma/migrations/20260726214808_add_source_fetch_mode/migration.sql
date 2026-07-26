-- CreateEnum
CREATE TYPE "SourceFetchMode" AS ENUM ('PLAIN', 'RENDER');

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "fetchMode" "SourceFetchMode" NOT NULL DEFAULT 'PLAIN';
