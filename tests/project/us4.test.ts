import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LOGIN = "/users/login";
// 프로젝트 기능 라우터는 /projects 한 줄로 마운트된다: 상세는 GET /projects/:id, 내 목록은 GET /projects
const PROJECTS = "/projects";
// tag 기능의 관리자 삭제 경로(/tags/<종류>/:id)
const TECH_STACKS = "/tags/tech-stacks";
const POSITIONS = "/tags/positions";

const PASSWORD = "password1";

type Tag = { id: string; name: string };

const seedUser = async (nickname: string, role: "USER" | "ADMIN" = "USER") =>
  prisma.user.create({
    data: {
      email: `${nickname}@example.com`,
      nickname,
      role,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
    },
  });

// 저장된 사용자로 로그인한 agent(세션 쿠키 유지)를 돌려준다
const loginWith = async (user: { email: string }) => {
  const agent = request.agent(app);
  const res = await agent.post(LOGIN).send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
};

// 관리자(역할은 운영자가 저장소에서 지정)로 로그인한 agent
const loginAdmin = async () => loginWith(await seedUser("admin", "ADMIN"));

// 관리자가 등록해 둔 것처럼 태그를 저장소에 직접 넣는다
const techStack = (name: string) => prisma.techStack.create({ data: { name } });
const position = (name: string) => prisma.position.create({ data: { name } });

/**
 * 생성 기능을 거친 것처럼 저장소에 프로젝트를 직접 넣는다:
 * 프로젝트, 프로젝트 포지션(이름은 마스터 포지션에서 가져옴), 기술 스택 연결, 포지션 없는 팀장 기록.
 */
const seedProject = (
  leaderId: string,
  options: { name?: string; techStacks?: Tag[]; positions?: { position: Tag; capacity: number }[] } = {},
) =>
  prisma.project.create({
    data: {
      leaderId,
      name: options.name ?? "MOP",
      description: "개발자 팀 매칭 플랫폼",
      duration: "M3_TO_6",
      meetingType: "ONLINE",
      techStacks: { create: (options.techStacks ?? []).map((t) => ({ techStackId: t.id })) },
      positions: {
        create: (options.positions ?? []).map((p) => ({ positionId: p.position.id, capacity: p.capacity })),
      },
      members: { create: { userId: leaderId, role: "LEADER" } },
    },
  });

// 합류 기능이 만든 것처럼 팀원(MEMBER) 기록을 저장소에 직접 넣는다
const seedMember = (projectId: string, userId: string, projectPositionId: string) =>
  prisma.projectMember.create({ data: { projectId, userId, role: "MEMBER", projectPositionId } });

// 프로젝트 안에서 마스터 포지션에 대응하는 프로젝트 포지션
const projectPosition = (projectId: string, positionId: string) =>
  prisma.projectPosition.findFirstOrThrow({ where: { projectId, positionId } });

// 프로젝트 하나의 저장 상태(프로젝트 행, 포지션, 기술 스택 연결, 팀원 기록)
const projectState = async (projectId: string) => ({
  project: await prisma.project.findUnique({ where: { id: projectId } }),
  positions: await prisma.projectPosition.findMany({ where: { projectId }, orderBy: { id: "asc" } }),
  techStacks: await prisma.projectTechStack.findMany({ where: { projectId }, orderBy: { techStackId: "asc" } }),
  members: await prisma.projectMember.findMany({ where: { projectId }, orderBy: { id: "asc" } }),
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ProjectMember", "ProjectPosition", "ProjectTechStack", "Project", "TechStack", "Position", "User" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US4 관리자가 태그를 삭제해도 프로젝트는 남는다", () => {
  describe("시나리오 1: 기술 스택 태그 삭제", () => {
    it("기술 스택 React를 쓰는 프로젝트가 있을 때 관리자가 React를 삭제하면 204이고 프로젝트는 남으며 그 프로젝트의 React 연결만 사라지고 이후 상세의 기술 스택 목록에 React가 없다", async () => {
      const react = await techStack("React");
      const node = await techStack("Node.js");
      const backend = await position("백엔드");
      const leader = await seedUser("alice");
      const other = await seedUser("bob");
      const project = await seedProject(leader.id, {
        techStacks: [react, node],
        positions: [{ position: backend, capacity: 2 }],
      });
      // React를 쓰지 않는 다른 프로젝트는 영향받지 않는다
      const untouched = await seedProject(other.id, { name: "다른 프로젝트", techStacks: [node] });
      const before = await projectState(project.id);
      const untouchedBefore = await projectState(untouched.id);
      const admin = await loginAdmin();

      const res = await admin.delete(`${TECH_STACKS}/${react.id}`);

      expect(res.status).toBe(204);
      // 태그는 삭제됐다
      expect(await prisma.techStack.findUnique({ where: { id: react.id } })).toBeNull();
      // 프로젝트·포지션·팀원 기록은 그대로이고 연결은 React만 사라졌다
      const after = await projectState(project.id);
      expect(after.project).toEqual(before.project);
      expect(after.positions).toEqual(before.positions);
      expect(after.members).toEqual(before.members);
      expect(after.techStacks).toEqual([{ projectId: project.id, techStackId: node.id }]);
      expect(await prisma.projectTechStack.count({ where: { techStackId: react.id } })).toBe(0);
      expect(await projectState(untouched.id)).toEqual(untouchedBefore);

      // 이후 상세의 기술 스택 목록에 React가 없다
      const detail = await (await loginWith(leader)).get(`${PROJECTS}/${project.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.id).toBe(project.id);
      expect(detail.body.techStacks).toEqual([{ id: node.id, name: "Node.js" }]);
      expect(detail.body.positions).toEqual([
        { id: before.positions[0]?.id, position: { id: backend.id, name: "백엔드" }, capacity: 2 },
      ]);
    });
  });

  describe("시나리오 2: 팀원이 배정된 포지션 태그 삭제", () => {
    it("포지션 백엔드로 만든 프로젝트 포지션에 팀원 한 명이 배정돼 있을 때 관리자가 백엔드를 삭제하면 204이고 그 프로젝트 포지션은 삭제되며 팀원 기록은 남되 포지션 없음으로 바뀌고 팀장 기록과 다른 프로젝트 포지션은 그대로다", async () => {
      const react = await techStack("React");
      const backend = await position("백엔드");
      const frontend = await position("프론트엔드");
      const leader = await seedUser("alice");
      const memberUser = await seedUser("bob");
      const frontUser = await seedUser("carol");
      const project = await seedProject(leader.id, {
        techStacks: [react],
        positions: [
          { position: backend, capacity: 2 },
          { position: frontend, capacity: 3 },
        ],
      });
      const backendPosition = await projectPosition(project.id, backend.id);
      const frontendPosition = await projectPosition(project.id, frontend.id);
      const member = await seedMember(project.id, memberUser.id, backendPosition.id);
      // 삭제되지 않는 포지션에 배정된 팀원 기록은 그대로여야 한다
      const frontMember = await seedMember(project.id, frontUser.id, frontendPosition.id);
      const leaderBefore = await prisma.projectMember.findFirstOrThrow({ where: { projectId: project.id, role: "LEADER" } });
      const before = await projectState(project.id);
      const admin = await loginAdmin();

      const res = await admin.delete(`${POSITIONS}/${backend.id}`);

      expect(res.status).toBe(204);
      expect(await prisma.position.findUnique({ where: { id: backend.id } })).toBeNull();
      // 백엔드 프로젝트 포지션만 삭제되고 프론트엔드 프로젝트 포지션은 그대로다
      expect(await prisma.projectPosition.findUnique({ where: { id: backendPosition.id } })).toBeNull();
      const after = await projectState(project.id);
      expect(after.positions).toEqual([frontendPosition]);
      // 프로젝트와 기술 스택 연결은 그대로다
      expect(after.project).toEqual(before.project);
      expect(after.techStacks).toEqual(before.techStacks);
      // 배정돼 있던 팀원 기록은 남고 역할·탈퇴 여부는 그대로, 포지션만 없음
      expect(await prisma.projectMember.findUnique({ where: { id: member.id } })).toEqual({
        ...member,
        projectPositionId: null,
      });
      // 팀장 기록과 다른 포지션의 팀원 기록은 바뀌지 않는다
      expect(await prisma.projectMember.findUnique({ where: { id: leaderBefore.id } })).toEqual(leaderBefore);
      expect(await prisma.projectMember.findUnique({ where: { id: frontMember.id } })).toEqual(frontMember);
      expect(after.members).toHaveLength(3);

      // 포지션 없음이 된 팀원도 현재 팀원이라 상세를 볼 수 있고 내 목록에 MEMBER로 나온다
      const memberAgent = await loginWith(memberUser);
      const detail = await memberAgent.get(`${PROJECTS}/${project.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.positions).toEqual([
        { id: frontendPosition.id, position: { id: frontend.id, name: "프론트엔드" }, capacity: 3 },
      ]);
      expect(detail.body.leader).toEqual({ id: leader.id, nickname: "alice" });
      const list = await memberAgent.get(PROJECTS);
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].id).toBe(project.id);
      expect(list.body.items[0].myRole).toBe("MEMBER");
    });
  });

  describe("시나리오 3: 팀장이 가진 포지션 태그 삭제", () => {
    it("팀장 기록에 포지션 PM으로 만든 프로젝트 포지션이 배정돼 있을 때 관리자가 PM을 삭제하면 204이고 그 프로젝트 포지션은 삭제되며 팀장 기록은 역할이 팀장인 채로 포지션만 없음이 되고 상세의 leader와 목록의 myRole LEADER는 그대로다", async () => {
      const pm = await position("PM");
      const backend = await position("백엔드");
      const leader = await seedUser("alice");
      const project = await seedProject(leader.id, {
        positions: [
          { position: pm, capacity: 1 },
          { position: backend, capacity: 2 },
        ],
      });
      const pmPosition = await projectPosition(project.id, pm.id);
      const backendPosition = await projectPosition(project.id, backend.id);
      // 팀장 기능이 배정한 것처럼 팀장 기록에 PM 프로젝트 포지션을 저장소에서 직접 지정한다
      const leaderBefore = await prisma.projectMember.update({
        where: { id: (await prisma.projectMember.findFirstOrThrow({ where: { projectId: project.id, role: "LEADER" } })).id },
        data: { projectPositionId: pmPosition.id },
      });
      const before = await projectState(project.id);
      const admin = await loginAdmin();

      const res = await admin.delete(`${POSITIONS}/${pm.id}`);

      expect(res.status).toBe(204);
      expect(await prisma.position.findUnique({ where: { id: pm.id } })).toBeNull();
      expect(await prisma.projectPosition.findUnique({ where: { id: pmPosition.id } })).toBeNull();
      const after = await projectState(project.id);
      expect(after.positions).toEqual([backendPosition]);
      expect(after.project).toEqual(before.project);
      // 팀장 기록은 남고 역할은 LEADER 그대로, 포지션만 없음
      expect(after.members).toEqual([{ ...leaderBefore, projectPositionId: null }]);
      expect(after.members[0]?.role).toBe("LEADER");

      const agent = await loginWith(leader);
      const detail = await agent.get(`${PROJECTS}/${project.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.leader).toEqual({ id: leader.id, nickname: "alice" });
      expect(detail.body.positions).toEqual([
        { id: backendPosition.id, position: { id: backend.id, name: "백엔드" }, capacity: 2 },
      ]);
      const list = await agent.get(PROJECTS);
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].id).toBe(project.id);
      expect(list.body.items[0].myRole).toBe("LEADER");
      expect(list.body.items[0].leader).toEqual({ id: leader.id, nickname: "alice" });
    });
  });

  describe("시나리오 4: 유일한 포지션의 태그 삭제", () => {
    it("포지션 백엔드를 쓰는 프로젝트 포지션이 그 프로젝트의 유일한 포지션일 때 관리자가 백엔드를 삭제하면 204이고 프로젝트는 포지션 0개로 남으며 상세 조회는 200에 빈 포지션 목록이다", async () => {
      const react = await techStack("React");
      const backend = await position("백엔드");
      const leader = await seedUser("alice");
      const project = await seedProject(leader.id, {
        techStacks: [react],
        positions: [{ position: backend, capacity: 4 }],
      });
      const before = await projectState(project.id);
      const admin = await loginAdmin();

      const res = await admin.delete(`${POSITIONS}/${backend.id}`);

      expect(res.status).toBe(204);
      expect(await prisma.position.findUnique({ where: { id: backend.id } })).toBeNull();
      const after = await projectState(project.id);
      // 프로젝트는 그대로 남고 포지션은 0개
      expect(after.project).toEqual(before.project);
      expect(after.positions).toEqual([]);
      expect(after.techStacks).toEqual(before.techStacks);
      expect(after.members).toEqual(before.members);

      const detail = await (await loginWith(leader)).get(`${PROJECTS}/${project.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toEqual({
        id: project.id,
        name: "MOP",
        description: "개발자 팀 매칭 플랫폼",
        duration: "M3_TO_6",
        meetingType: "ONLINE",
        leader: { id: leader.id, nickname: "alice" },
        techStacks: [{ id: react.id, name: "React" }],
        positions: [],
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      });
    });
  });
});
