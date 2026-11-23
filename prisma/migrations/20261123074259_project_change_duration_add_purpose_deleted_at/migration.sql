/*
  Warnings:

  - Added the required column `purpose` to the `projects` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `duration` on the `projects` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "ProjectPurpose" AS ENUM ('CONTEST', 'PORTFOLIO', 'STARTUP');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "purpose" "ProjectPurpose" NOT NULL,
DROP COLUMN "duration",
ADD COLUMN     "duration" INTEGER NOT NULL;

-- DropEnum
DROP TYPE "ProjectDuration";
