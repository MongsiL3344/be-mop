-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "introduction" TEXT,
ADD COLUMN     "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'USER';
