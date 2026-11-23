-- 테이블 이름을 스네이크 케이스 복수형으로 변경 (손으로 작성: RENAME이라 데이터와 lower("name") 인덱스가 유지됨)
ALTER TABLE "User" RENAME TO "users";
ALTER TABLE "TechStack" RENAME TO "tech_stacks";
ALTER TABLE "Position" RENAME TO "positions";
ALTER TABLE "UserTechStack" RENAME TO "user_tech_stacks";
ALTER TABLE "UserPosition" RENAME TO "user_positions";
ALTER TABLE "Notification" RENAME TO "notifications";
ALTER TABLE "Project" RENAME TO "projects";
ALTER TABLE "ProjectTechStack" RENAME TO "project_tech_stacks";
ALTER TABLE "ProjectPosition" RENAME TO "project_positions";
ALTER TABLE "ProjectMember" RENAME TO "project_members";

-- 컬럼 이름 변경
ALTER TABLE "users" RENAME COLUMN "passwordHash" TO "password_hash";

-- 기본 키 이름을 새 테이블 이름에 맞춤
ALTER TABLE "users" RENAME CONSTRAINT "User_pkey" TO "users_pkey";
ALTER TABLE "tech_stacks" RENAME CONSTRAINT "TechStack_pkey" TO "tech_stacks_pkey";
ALTER TABLE "positions" RENAME CONSTRAINT "Position_pkey" TO "positions_pkey";
ALTER TABLE "user_tech_stacks" RENAME CONSTRAINT "UserTechStack_pkey" TO "user_tech_stacks_pkey";
ALTER TABLE "user_positions" RENAME CONSTRAINT "UserPosition_pkey" TO "user_positions_pkey";
ALTER TABLE "notifications" RENAME CONSTRAINT "Notification_pkey" TO "notifications_pkey";
ALTER TABLE "projects" RENAME CONSTRAINT "Project_pkey" TO "projects_pkey";
ALTER TABLE "project_tech_stacks" RENAME CONSTRAINT "ProjectTechStack_pkey" TO "project_tech_stacks_pkey";
ALTER TABLE "project_positions" RENAME CONSTRAINT "ProjectPosition_pkey" TO "project_positions_pkey";
ALTER TABLE "project_members" RENAME CONSTRAINT "ProjectMember_pkey" TO "project_members_pkey";

-- 외래 키 이름을 새 테이블 이름에 맞춤
ALTER TABLE "notifications" RENAME CONSTRAINT "Notification_user_id_fkey" TO "notifications_user_id_fkey";
ALTER TABLE "user_tech_stacks" RENAME CONSTRAINT "UserTechStack_user_id_fkey" TO "user_tech_stacks_user_id_fkey";
ALTER TABLE "user_tech_stacks" RENAME CONSTRAINT "UserTechStack_tech_stack_id_fkey" TO "user_tech_stacks_tech_stack_id_fkey";
ALTER TABLE "user_positions" RENAME CONSTRAINT "UserPosition_user_id_fkey" TO "user_positions_user_id_fkey";
ALTER TABLE "user_positions" RENAME CONSTRAINT "UserPosition_position_id_fkey" TO "user_positions_position_id_fkey";
ALTER TABLE "projects" RENAME CONSTRAINT "Project_leader_id_fkey" TO "projects_leader_id_fkey";
ALTER TABLE "project_positions" RENAME CONSTRAINT "ProjectPosition_project_id_fkey" TO "project_positions_project_id_fkey";
ALTER TABLE "project_positions" RENAME CONSTRAINT "ProjectPosition_position_id_fkey" TO "project_positions_position_id_fkey";
ALTER TABLE "project_tech_stacks" RENAME CONSTRAINT "ProjectTechStack_project_id_fkey" TO "project_tech_stacks_project_id_fkey";
ALTER TABLE "project_tech_stacks" RENAME CONSTRAINT "ProjectTechStack_tech_stack_id_fkey" TO "project_tech_stacks_tech_stack_id_fkey";
ALTER TABLE "project_members" RENAME CONSTRAINT "ProjectMember_project_id_fkey" TO "project_members_project_id_fkey";
ALTER TABLE "project_members" RENAME CONSTRAINT "ProjectMember_user_id_fkey" TO "project_members_user_id_fkey";
ALTER TABLE "project_members" RENAME CONSTRAINT "ProjectMember_project_position_id_fkey" TO "project_members_project_position_id_fkey";

-- 인덱스 이름을 새 테이블 이름에 맞춤
ALTER INDEX "User_email_key" RENAME TO "users_email_key";
ALTER INDEX "User_nickname_key" RENAME TO "users_nickname_key";
ALTER INDEX "Notification_user_id_created_at_idx" RENAME TO "notifications_user_id_created_at_idx";
ALTER INDEX "TechStack_name_lower_key" RENAME TO "tech_stacks_name_lower_key";
ALTER INDEX "Position_name_lower_key" RENAME TO "positions_name_lower_key";
ALTER INDEX "ProjectPosition_project_id_position_id_key" RENAME TO "project_positions_project_id_position_id_key";
ALTER INDEX "ProjectMember_project_id_user_id_key" RENAME TO "project_members_project_id_user_id_key";
ALTER INDEX "ProjectMember_project_id_leader_key" RENAME TO "project_members_project_id_leader_key";
