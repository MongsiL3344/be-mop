-- CreateEnum
CREATE TYPE "ProjectDuration" AS ENUM ('UNDER_3M', 'M3_TO_6', 'M6_TO_12', 'OVER_1Y');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('OFFLINE', 'ONLINE');

-- CreateEnum
CREATE TYPE "ProjectMemberRole" AS ENUM ('LEADER', 'MEMBER');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "leader_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration" "ProjectDuration" NOT NULL,
    "meeting_type" "MeetingType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPosition" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "ProjectPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTechStack" (
    "project_id" TEXT NOT NULL,
    "tech_stack_id" TEXT NOT NULL,

    CONSTRAINT "ProjectTechStack_pkey" PRIMARY KEY ("project_id","tech_stack_id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_position_id" TEXT,
    "role" "ProjectMemberRole" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPosition_project_id_position_id_key" ON "ProjectPosition"("project_id", "position_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_project_id_user_id_key" ON "ProjectMember"("project_id", "user_id") WHERE ("left_at" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_project_id_leader_key" ON "ProjectMember"("project_id") WHERE ("role" = 'LEADER');

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPosition" ADD CONSTRAINT "ProjectPosition_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPosition" ADD CONSTRAINT "ProjectPosition_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTechStack" ADD CONSTRAINT "ProjectTechStack_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTechStack" ADD CONSTRAINT "ProjectTechStack_tech_stack_id_fkey" FOREIGN KEY ("tech_stack_id") REFERENCES "TechStack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_project_position_id_fkey" FOREIGN KEY ("project_position_id") REFERENCES "ProjectPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
