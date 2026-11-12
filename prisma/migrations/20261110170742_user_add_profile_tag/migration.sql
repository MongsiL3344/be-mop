-- CreateTable
CREATE TABLE "UserTechStack" (
    "user_id" TEXT NOT NULL,
    "tech_stack_id" TEXT NOT NULL,

    CONSTRAINT "UserTechStack_pkey" PRIMARY KEY ("user_id","tech_stack_id")
);

-- CreateTable
CREATE TABLE "UserPosition" (
    "user_id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,

    CONSTRAINT "UserPosition_pkey" PRIMARY KEY ("user_id","position_id")
);

-- AddForeignKey
ALTER TABLE "UserTechStack" ADD CONSTRAINT "UserTechStack_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTechStack" ADD CONSTRAINT "UserTechStack_tech_stack_id_fkey" FOREIGN KEY ("tech_stack_id") REFERENCES "TechStack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPosition" ADD CONSTRAINT "UserPosition_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPosition" ADD CONSTRAINT "UserPosition_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;
