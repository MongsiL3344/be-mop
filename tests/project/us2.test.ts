import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LOGIN = "/users/login";
// 프로젝트 기능 라우터는 /projects 한 줄로 마운트되고, 상세 조회는 GET /projects/:id다
const PROJECTS = "/projects";
const detailPath = (id: string) => `${PROJECTS}/${id}`;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// 형식은 올바른 UUID지만 저장소에 없는 프로젝트 id
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

const PASSWORD = "password1";

type Tag = { id: string; name: string };

const seedUser = async (nickname: string) =>
  prisma.user.create({
    data: {
      email: `${nickname}@example.com`,
      nickname,
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

// 사용자를 만들고 로그인한 agent를 돌려준다
const loginAs = async (nickname: string) => {
  const user = await seedUser(nickname);
  return { agent: await loginWith(user), user };
};

// 관리자가 등록해 둔 것처럼 태그를 저장소에 직접 넣는다
const techStack = (name: string) => prisma.techStack.create({ data: { name } });
const position = (name: string) => prisma.position.create({ data: { name } });

/**
 * 생성 기능을 거친 것처럼 저장소에 프로젝트를 직접 넣는다:
 * 프로젝트, 프로젝트 포지션(마스터 이름 복사), 기술 스택 연결, 포지션 없는 팀장 기록
 */
const seedProject = async (
  leaderId: string,
  options: {
    name?: string;
    description?: string | null;
    techStacks?: Tag[];
    positions?: { position: Tag; capacity: number }[];
  } = {},
) =>
  prisma.project.create({
    data: {
      leaderId,
      name: options.name ?? "MOP",
      description: options.description === undefined ? "개발자 팀 매칭 플랫폼" : options.description,
      duration: "M3_TO_6",
      meetingType: "ONLINE",
      techStacks: { create: (options.techStacks ?? []).map((t) => ({ techStackId: t.id })) },
      positions: {
        create: (options.positions ?? []).map((p) => ({
          positionId: p.position.id,
          name: p.position.name,
          capacity: p.capacity,
        })),
      },
      members: { create: { userId: leaderId, role: "LEADER" } },
    },
  });

// 프로젝트 안에서 마스터 포지션에 대응하는 프로젝트 포지션 id
const projectPositionId = async (projectId: string, positionId: string) =>
  (await prisma.projectPosition.findFirstOrThrow({ where: { projectId, positionId } })).id;

// 조회 전후로 바뀌면 안 되는 저장 상태(프로젝트·포지션·연결·팀원 기록 전체)
const snapshot = async () => ({
  projects: await prisma.project.findMany({ orderBy: { id: "asc" } }),
  projectPositions: await prisma.projectPosition.findMany({ orderBy: { id: "asc" } }),
  projectTechStacks: await prisma.projectTechStack.findMany({
    orderBy: [{ projectId: "asc" }, { techStackId: "asc" }],
  }),
  projectMembers: await prisma.projectMember.findMany({ orderBy: { id: "asc" } }),
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ProjectMember", "ProjectPosition", "ProjectTechStack", "Project", "TechStack", "Position", "User" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US2 프로젝트 상세를 조회한다", () => {
  describe("시나리오 1: 팀장의 상세 조회", () => {
    it("프로젝트가 있을 때 그 프로젝트의 팀장으로 로그인해 상세를 조회하면 200과 저장된 값과 같은 FR-008 상세(이메일·팀원 목록·workspaceId 없음)가 오고 저장 상태는 바뀌지 않는다", async () => {
      const react = await techStack("React");
      const backend = await position("백엔드");
      const { agent, user } = await loginAs("leader");
      const project = await seedProject(user.id, {
        techStacks: [react],
        positions: [{ position: backend, capacity: 3 }],
      });
      const before = await snapshot();

      const res = await agent.get(detailPath(project.id));

      expect(res.status).toBe(200);
      // 정확히 FR-008 필드만: 팀장 이메일·역할, 팀원 목록, workspaceId 등은 없다
      expect(res.body).toEqual({
        id: project.id,
        name: "MOP",
        description: "개발자 팀 매칭 플랫폼",
        duration: "M3_TO_6",
        meetingType: "ONLINE",
        leader: { id: user.id, nickname: "leader" },
        techStacks: [{ id: react.id, name: "React" }],
        positions: [
          { id: await projectPositionId(project.id, backend.id), positionId: backend.id, name: "백엔드", capacity: 3 },
        ],
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      });
      expect(res.body.createdAt).toMatch(ISO);
      expect(res.body.updatedAt).toMatch(ISO);

      // 조회는 저장 상태를 바꾸지 않는다
      expect(await snapshot()).toEqual(before);
    });

    it("소개가 없고(null) 기술 스택·포지션이 없는 프로젝트가 있을 때 팀장이 상세를 조회하면 200과 description null, 빈 techStacks·positions가 오고 저장 상태는 바뀌지 않는다", async () => {
      const { agent, user } = await loginAs("leader");
      const project = await seedProject(user.id, { name: "빈 프로젝트", description: null });
      const before = await snapshot();

      const res = await agent.get(detailPath(project.id));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: project.id,
        name: "빈 프로젝트",
        description: null,
        duration: "M3_TO_6",
        meetingType: "ONLINE",
        leader: { id: user.id, nickname: "leader" },
        techStacks: [],
        positions: [],
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      });
      expect(await snapshot()).toEqual(before);
    });

    it("팀장이 프로젝트를 여러 개 가지고 있을 때 그중 하나를 조회하면 200과 그 프로젝트의 상세만 온다", async () => {
      const react = await techStack("React");
      const vue = await techStack("Vue");
      const { agent, user } = await loginAs("leader");
      await seedProject(user.id, { name: "첫 번째", techStacks: [vue] });
      const target = await seedProject(user.id, { name: "두 번째", techStacks: [react] });

      const res = await agent.get(detailPath(target.id));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: target.id,
        name: "두 번째",
        leader: { id: user.id, nickname: "leader" },
        techStacks: [{ id: react.id, name: "React" }],
      });
      expect(await prisma.project.count()).toBe(2);
    });
  });

  describe("시나리오 2: 포지션·기술 스택 정렬", () => {
    it("포지션과 기술 스택이 여러 개(대소문자가 섞인 이름, 저장 순서와 정렬 순서가 다름)일 때 팀장이 상세를 조회하면 둘 다 대소문자 무시 이름 오름차순으로 온다", async () => {
      // 대소문자 무시: aws < Node.js < react < TypeScript (대소문자 구분이면 Node.js < TypeScript < aws < react)
      const react = await techStack("react");
      const typescript = await techStack("TypeScript");
      const aws = await techStack("aws");
      const node = await techStack("Node.js");
      // 대소문자 무시: devops < Frontend < 디자이너 < 백엔드 (대소문자 구분이면 Frontend < devops)
      const backend = await position("백엔드");
      const frontend = await position("Frontend");
      const designer = await position("디자이너");
      const devops = await position("devops");
      const { agent, user } = await loginAs("leader");
      const project = await seedProject(user.id, {
        techStacks: [react, typescript, aws, node],
        positions: [
          { position: backend, capacity: 2 },
          { position: frontend, capacity: 3 },
          { position: designer, capacity: 1 },
          { position: devops, capacity: 20 },
        ],
      });

      const res = await agent.get(detailPath(project.id));

      expect(res.status).toBe(200);
      expect(res.body.techStacks).toEqual([
        { id: aws.id, name: "aws" },
        { id: node.id, name: "Node.js" },
        { id: react.id, name: "react" },
        { id: typescript.id, name: "TypeScript" },
      ]);
      expect(res.body.positions).toEqual([
        { id: await projectPositionId(project.id, devops.id), positionId: devops.id, name: "devops", capacity: 20 },
        { id: await projectPositionId(project.id, frontend.id), positionId: frontend.id, name: "Frontend", capacity: 3 },
        { id: await projectPositionId(project.id, designer.id), positionId: designer.id, name: "디자이너", capacity: 1 },
        { id: await projectPositionId(project.id, backend.id), positionId: backend.id, name: "백엔드", capacity: 2 },
      ]);
      // 저장 상태: 포지션 4개·연결 4개 그대로
      expect(await prisma.projectPosition.count({ where: { projectId: project.id } })).toBe(4);
      expect(await prisma.projectTechStack.count({ where: { projectId: project.id } })).toBe(4);
    });

    it("마스터 포지션 이름이 생성 뒤 바뀌었을 때 팀장이 상세를 조회하면 포지션 이름은 프로젝트 포지션에 복사된 이름으로 오고 그 이름 기준으로 정렬된다", async () => {
      const alpha = await position("Alpha");
      const beta = await position("beta");
      const { agent, user } = await loginAs("leader");
      const project = await seedProject(user.id, {
        positions: [
          { position: alpha, capacity: 1 },
          { position: beta, capacity: 2 },
        ],
      });
      // 관리자가 마스터 이름을 바꾼 것처럼: 마스터 이름 기준이면 순서가 뒤집힌다
      await prisma.position.update({ where: { id: alpha.id }, data: { name: "zeta" } });

      const res = await agent.get(detailPath(project.id));

      expect(res.status).toBe(200);
      expect(res.body.positions).toEqual([
        { id: await projectPositionId(project.id, alpha.id), positionId: alpha.id, name: "Alpha", capacity: 1 },
        { id: await projectPositionId(project.id, beta.id), positionId: beta.id, name: "beta", capacity: 2 },
      ]);
      expect(
        (await prisma.projectPosition.findFirstOrThrow({ where: { projectId: project.id, positionId: alpha.id } })).name,
      ).toBe("Alpha");
    });
  });

  describe("시나리오 3: 현재 팀원(역할 팀원)의 상세 조회", () => {
    it("그 프로젝트에 현재 팀원 기록(역할 MEMBER, 탈퇴·제외 안 됨)이 있는 사용자가 상세를 조회하면 200과 팀장이 보는 것과 같은 상세가 오고 저장 상태는 바뀌지 않는다", async () => {
      const react = await techStack("React");
      const node = await techStack("Node.js");
      const frontend = await position("프론트엔드");
      const backend = await position("백엔드");
      const leader = await loginAs("leader");
      const project = await seedProject(leader.user.id, {
        techStacks: [react, node],
        positions: [
          { position: frontend, capacity: 2 },
          { position: backend, capacity: 1 },
        ],
      });
      const member = await loginAs("member");
      await prisma.projectMember.create({ data: { projectId: project.id, userId: member.user.id, role: "MEMBER" } });
      const before = await snapshot();

      const leaderRes = await leader.agent.get(detailPath(project.id));
      const memberRes = await member.agent.get(detailPath(project.id));

      expect(leaderRes.status).toBe(200);
      expect(memberRes.status).toBe(200);
      expect(memberRes.body).toEqual(leaderRes.body);
      // 팀장 정보는 조회한 팀원이 아니라 실제 팀장이다
      expect(memberRes.body).toMatchObject({ id: project.id, leader: { id: leader.user.id, nickname: "leader" } });
      expect(await snapshot()).toEqual(before);
    });

    it("포지션이 배정된 현재 팀원이 상세를 조회하면 200과 팀장이 보는 것과 같은 상세가 온다", async () => {
      const frontend = await position("프론트엔드");
      const leader = await loginAs("leader");
      const project = await seedProject(leader.user.id, { positions: [{ position: frontend, capacity: 2 }] });
      const frontendPositionId = await projectPositionId(project.id, frontend.id);
      const member = await loginAs("member");
      await prisma.projectMember.create({
        data: { projectId: project.id, userId: member.user.id, role: "MEMBER", projectPositionId: frontendPositionId },
      });

      const leaderRes = await leader.agent.get(detailPath(project.id));
      const memberRes = await member.agent.get(detailPath(project.id));

      expect(memberRes.status).toBe(200);
      expect(memberRes.body).toEqual(leaderRes.body);
      expect(memberRes.body.positions).toEqual([
        { id: frontendPositionId, positionId: frontend.id, name: "프론트엔드", capacity: 2 },
      ]);
      expect(await prisma.projectMember.count({ where: { projectId: project.id, leftAt: null } })).toBe(2);
    });

    it("포지션 태그 삭제로 포지션 없음이 된 현재 팀원이 상세를 조회하면 200과 삭제된 포지션이 빠진 상세가 온다", async () => {
      const frontend = await position("프론트엔드");
      const backend = await position("백엔드");
      const leader = await loginAs("leader");
      const project = await seedProject(leader.user.id, {
        positions: [
          { position: frontend, capacity: 2 },
          { position: backend, capacity: 1 },
        ],
      });
      const member = await loginAs("member");
      await prisma.projectMember.create({
        data: {
          projectId: project.id,
          userId: member.user.id,
          role: "MEMBER",
          projectPositionId: await projectPositionId(project.id, frontend.id),
        },
      });
      const backendPositionId = await projectPositionId(project.id, backend.id);
      // 관리자가 마스터 포지션을 삭제한 것처럼: 프로젝트 포지션은 함께 삭제되고 팀원 기록은 포지션 없음으로 남는다
      await prisma.position.delete({ where: { id: frontend.id } });

      const res = await member.agent.get(detailPath(project.id));

      expect(res.status).toBe(200);
      expect(res.body.positions).toEqual([
        { id: backendPositionId, positionId: backend.id, name: "백엔드", capacity: 1 },
      ]);
      expect(
        await prisma.projectMember.findFirstOrThrow({ where: { projectId: project.id, userId: member.user.id } }),
      ).toMatchObject({ role: "MEMBER", projectPositionId: null, leftAt: null });
    });
  });

  describe("시나리오 4: 팀원이 아니거나 탈퇴·제외된 사용자", () => {
    it("그 프로젝트의 팀원 기록이 없는 로그인 사용자가 상세를 조회하면 403이 오고 상세는 담기지 않으며 저장 상태는 바뀌지 않는다", async () => {
      const react = await techStack("React");
      const leader = await seedUser("leader");
      const project = await seedProject(leader.id, { techStacks: [react] });
      const { agent } = await loginAs("stranger");
      const before = await snapshot();

      const res = await agent.get(detailPath(project.id));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: expect.any(String) });
      expect(await snapshot()).toEqual(before);
    });

    it("다른 프로젝트의 팀장이지만 이 프로젝트의 팀원이 아닌 사용자가 상세를 조회하면 403이 온다", async () => {
      const leader = await seedUser("leader");
      const project = await seedProject(leader.id, { name: "대상" });
      const other = await loginAs("other");
      await seedProject(other.user.id, { name: "다른 프로젝트" });
      const before = await snapshot();

      const res = await other.agent.get(detailPath(project.id));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: expect.any(String) });
      expect(await snapshot()).toEqual(before);
    });

    it("그 프로젝트의 팀원 기록이 탈퇴·제외 처리된(leftAt 있음) 사용자가 상세를 조회하면 403이 오고 그 기록은 그대로 남는다", async () => {
      const leader = await seedUser("leader");
      const project = await seedProject(leader.id);
      const { agent, user } = await loginAs("former");
      const leftAt = new Date("2026-11-01T00:00:00.000Z");
      await prisma.projectMember.create({ data: { projectId: project.id, userId: user.id, role: "MEMBER", leftAt } });
      const before = await snapshot();

      const res = await agent.get(detailPath(project.id));

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: expect.any(String) });
      expect(await snapshot()).toEqual(before);
      expect(
        await prisma.projectMember.findFirstOrThrow({ where: { projectId: project.id, userId: user.id } }),
      ).toMatchObject({ role: "MEMBER", leftAt });
    });
  });

  describe("시나리오 5: 비로그인", () => {
    it("로그인하지 않은 상태로 있는 프로젝트의 상세를 조회하면 401이 오고 상세는 담기지 않는다", async () => {
      const leader = await seedUser("leader");
      const project = await seedProject(leader.id);
      const before = await snapshot();

      const res = await request(app).get(detailPath(project.id));

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: expect.any(String) });
      expect(await snapshot()).toEqual(before);
    });

    it("로그인하지 않은 상태로 id 형식이 틀리거나 없는 프로젝트를 조회해도 로그인 확인이 먼저라 401이 온다", async () => {
      const invalid = await request(app).get(detailPath("not-a-uuid"));
      const missing = await request(app).get(detailPath(MISSING_ID));

      expect(invalid.status).toBe(401);
      expect(invalid.body).toEqual({ error: expect.any(String) });
      expect(missing.status).toBe(401);
      expect(missing.body).toEqual({ error: expect.any(String) });
      expect(await prisma.project.count()).toBe(0);
    });

    it("팀장으로 로그인한 뒤 탈퇴 처리된 사용자의 세션으로 상세를 조회하면 비로그인과 같은 401이 온다", async () => {
      const { agent, user } = await loginAs("leader");
      const project = await seedProject(user.id);
      await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
      const before = await snapshot();

      const res = await agent.get(detailPath(project.id));

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: expect.any(String) });
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("시나리오 6: 없는 프로젝트", () => {
    it("로그인한 상태이고 해당 id의 프로젝트가 없을 때 상세를 조회하면 404가 오고 저장 상태는 바뀌지 않는다", async () => {
      const { agent, user } = await loginAs("leader");
      // 다른 프로젝트는 있어도 요청한 id의 프로젝트는 없다
      await seedProject(user.id);
      const before = await snapshot();

      const res = await agent.get(detailPath(MISSING_ID));

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: expect.any(String) });
      expect(await prisma.project.findUnique({ where: { id: MISSING_ID } })).toBeNull();
      expect(await snapshot()).toEqual(before);
    });

    it("로그인한 사용자가 팀원이 아닌 상태로 없는 프로젝트를 조회하면 팀원 여부보다 존재 확인이 먼저라 403이 아닌 404가 온다", async () => {
      const { agent } = await loginAs("stranger");

      const res = await agent.get(detailPath(MISSING_ID));

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: expect.any(String) });
      expect(await prisma.project.count()).toBe(0);
    });
  });

  describe("시나리오 7: 잘못된 id 형식", () => {
    it("로그인한 상태로 UUID가 아닌 id로 상세를 조회하면 400이 오고 저장 상태는 바뀌지 않는다", async () => {
      const { agent, user } = await loginAs("leader");
      await seedProject(user.id);
      const before = await snapshot();

      const res = await agent.get(detailPath("not-a-uuid"));

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: expect.any(String) });
      expect(await snapshot()).toEqual(before);
    });

    it("로그인한 상태로 UUID와 비슷하지만 형식이 틀린 id(글자 수 부족·허용되지 않는 문자)로 조회하면 각각 400이 온다", async () => {
      const { agent } = await loginAs("leader");

      for (const id of ["12345", "00000000-0000-4000-8000-00000000000", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"]) {
        const res = await agent.get(detailPath(id));
        expect(res.status, id).toBe(400);
        expect(res.body, id).toMatchObject({ error: expect.any(String) });
      }
      expect(await prisma.project.count()).toBe(0);
    });
  });
});
