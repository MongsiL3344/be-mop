import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LOGIN = "/users/login";
// 프로젝트 기능 라우터는 /projects 한 줄로 마운트되고, 내 프로젝트 목록 조회는 GET /projects다
const PROJECTS = "/projects";

const PASSWORD = "password1";

type Tag = { id: string; name: string };
type Item = { id: string; createdAt: string; myRole: string };

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
 * 프로젝트, 프로젝트 포지션(이름은 마스터 포지션에서 가져옴), 기술 스택 연결, 포지션 없는 팀장 기록.
 * createdAt을 주면 그 생성 시각으로 저장한다(정렬 검증용).
 */
const seedProject = async (
  leaderId: string,
  options: {
    name?: string;
    description?: string | null;
    duration?: "UNDER_3M" | "M3_TO_6" | "M6_TO_12" | "OVER_1Y";
    meetingType?: "OFFLINE" | "ONLINE";
    techStacks?: Tag[];
    positions?: { position: Tag; capacity: number }[];
    createdAt?: Date;
  } = {},
) =>
  prisma.project.create({
    data: {
      leaderId,
      name: options.name ?? "MOP",
      description: options.description === undefined ? "개발자 팀 매칭 플랫폼" : options.description,
      duration: options.duration ?? "M3_TO_6",
      meetingType: options.meetingType ?? "ONLINE",
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      techStacks: { create: (options.techStacks ?? []).map((t) => ({ techStackId: t.id })) },
      positions: {
        create: (options.positions ?? []).map((p) => ({ positionId: p.position.id, capacity: p.capacity })),
      },
      members: { create: { userId: leaderId, role: "LEADER" } },
    },
  });

// 합류 기능이 만든 것처럼 팀원(MEMBER) 기록을 저장소에 직접 넣는다
const seedMember = (
  projectId: string,
  userId: string,
  options: { leftAt?: Date; projectPositionId?: string } = {},
) =>
  prisma.projectMember.create({
    data: {
      projectId,
      userId,
      role: "MEMBER",
      leftAt: options.leftAt ?? null,
      projectPositionId: options.projectPositionId ?? null,
    },
  });

// 프로젝트 안에서 마스터 포지션에 대응하는 프로젝트 포지션 id
const projectPositionId = async (projectId: string, positionId: string) =>
  (await prisma.projectPosition.findFirstOrThrow({ where: { projectId, positionId } })).id;

// 시각 하나를 기준으로 분 단위로 떨어진 생성 시각
const BASE = Date.parse("2026-11-01T00:00:00.000Z");
const at = (minutes: number) => new Date(BASE + minutes * 60_000);

// 조회 전후로 바뀌면 안 되는 저장 상태(프로젝트·포지션·연결·팀원 기록 전체)
const snapshot = async () => ({
  projects: await prisma.project.findMany({ orderBy: { id: "asc" } }),
  projectPositions: await prisma.projectPosition.findMany({ orderBy: { id: "asc" } }),
  projectTechStacks: await prisma.projectTechStack.findMany({
    orderBy: [{ projectId: "asc" }, { techStackId: "asc" }],
  }),
  projectMembers: await prisma.projectMember.findMany({ orderBy: { id: "asc" } }),
});

const ids = (items: Item[]) => items.map((item) => item.id);

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ProjectMember", "ProjectPosition", "ProjectTechStack", "Project", "TechStack", "Position", "User" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US3 내 프로젝트 목록을 조회한다", () => {
  describe("시나리오 1: 내가 만든 프로젝트만 최근 생성순", () => {
    it("사용자 A가 프로젝트 두 개, 사용자 B가 프로젝트 하나를 만들었을 때 A로 로그인해 목록을 조회하면 200과 { items }로 A의 프로젝트 두 개만 생성 시각 내림차순으로 오고 각 항목은 FR-008 상세에 myRole LEADER를 더한 형태이며 저장 상태는 바뀌지 않는다", async () => {
      // 대소문자 무시: aws < Node.js < react (대소문자 구분이면 Node.js < aws < react)
      const react = await techStack("react");
      const node = await techStack("Node.js");
      const aws = await techStack("aws");
      // 대소문자 무시: devops < Frontend < 백엔드 (대소문자 구분이면 Frontend < devops)
      const backend = await position("백엔드");
      const frontend = await position("Frontend");
      const devops = await position("devops");
      const { agent, user: a } = await loginAs("alice");
      const b = await seedUser("bob");

      // 먼저 저장한 쪽이 더 최근 생성: 저장 순서가 아니라 생성 시각으로 정렬해야 한다
      const newer = await seedProject(a.id, {
        name: "A의 두 번째",
        description: null,
        duration: "OVER_1Y",
        meetingType: "OFFLINE",
        createdAt: at(30),
      });
      const bProject = await seedProject(b.id, { name: "B의 프로젝트", createdAt: at(20) });
      const older = await seedProject(a.id, {
        name: "A의 첫 번째",
        techStacks: [react, node, aws],
        positions: [
          { position: backend, capacity: 2 },
          { position: frontend, capacity: 3 },
          { position: devops, capacity: 1 },
        ],
        createdAt: at(10),
      });
      const before = await snapshot();

      const res = await agent.get(PROJECTS);

      expect(res.status).toBe(200);
      // 정확히 FR-008 필드 + myRole만: 팀장 이메일·역할, 팀원 목록, workspaceId 등은 없다
      expect(res.body).toEqual({
        items: [
          {
            id: newer.id,
            name: "A의 두 번째",
            description: null,
            duration: "OVER_1Y",
            meetingType: "OFFLINE",
            leader: { id: a.id, nickname: "alice" },
            techStacks: [],
            positions: [],
            createdAt: newer.createdAt.toISOString(),
            updatedAt: newer.updatedAt.toISOString(),
            myRole: "LEADER",
          },
          {
            id: older.id,
            name: "A의 첫 번째",
            description: "개발자 팀 매칭 플랫폼",
            duration: "M3_TO_6",
            meetingType: "ONLINE",
            leader: { id: a.id, nickname: "alice" },
            techStacks: [
              { id: aws.id, name: "aws" },
              { id: node.id, name: "Node.js" },
              { id: react.id, name: "react" },
            ],
            positions: [
              { id: await projectPositionId(older.id, devops.id), position: { id: devops.id, name: "devops" }, capacity: 1 },
              {
                id: await projectPositionId(older.id, frontend.id),
                position: { id: frontend.id, name: "Frontend" },
                capacity: 3,
              },
              { id: await projectPositionId(older.id, backend.id), position: { id: backend.id, name: "백엔드" }, capacity: 2 },
            ],
            createdAt: older.createdAt.toISOString(),
            updatedAt: older.updatedAt.toISOString(),
            myRole: "LEADER",
          },
        ],
      });
      expect(ids(res.body.items)).not.toContain(bProject.id);

      // 조회는 저장 상태를 바꾸지 않는다
      expect(await snapshot()).toEqual(before);
    });

    it("사용자 A가 생성 API로 프로젝트 두 개, 사용자 B가 하나를 만들었을 때 A와 B가 각각 목록을 조회하면 200과 자기 프로젝트만 생성 응답 상세에 myRole LEADER를 더한 형태로 생성 시각 내림차순으로 온다", async () => {
      const react = await techStack("React");
      const backend = await position("백엔드");
      const { agent: aAgent, user: a } = await loginAs("alice");
      const { agent: bAgent, user: b } = await loginAs("bob");

      const created1 = await aAgent.post(PROJECTS).send({
        name: "A의 첫 번째",
        description: "소개",
        duration: "UNDER_3M",
        meetingType: "ONLINE",
        techStackIds: [react.id],
        positions: [{ positionId: backend.id, capacity: 2 }],
      });
      const createdB = await bAgent.post(PROJECTS).send({ name: "B의 프로젝트", duration: "M6_TO_12", meetingType: "OFFLINE" });
      const created2 = await aAgent.post(PROJECTS).send({ name: "A의 두 번째", duration: "OVER_1Y", meetingType: "OFFLINE" });
      expect(created1.status).toBe(201);
      expect(createdB.status).toBe(201);
      expect(created2.status).toBe(201);

      const aRes = await aAgent.get(PROJECTS);
      const bRes = await bAgent.get(PROJECTS);

      expect(aRes.status).toBe(200);
      expect(Object.keys(aRes.body)).toEqual(["items"]);
      expect(aRes.body.items).toHaveLength(2);
      expect(aRes.body.items).toEqual(
        expect.arrayContaining([
          { ...created1.body, myRole: "LEADER" },
          { ...created2.body, myRole: "LEADER" },
        ]),
      );
      // 생성 시각 내림차순(저장소의 생성 시각 기준)
      const aStored = await prisma.project.findMany({ where: { leaderId: a.id } });
      const createdAtOf = (id: string) => aStored.find((p) => p.id === id)?.createdAt.getTime() ?? Number.NaN;
      const [first, second] = ids(aRes.body.items);
      expect(createdAtOf(first ?? "")).toBeGreaterThanOrEqual(createdAtOf(second ?? ""));

      expect(bRes.status).toBe(200);
      expect(bRes.body).toEqual({ items: [{ ...createdB.body, myRole: "LEADER" }] });

      // 저장소에도 A의 팀장 기록 2개, B의 팀장 기록 1개만 있다
      expect(
        await prisma.projectMember.findMany({ where: { userId: a.id }, select: { projectId: true, role: true, leftAt: true } }),
      ).toEqual(
        expect.arrayContaining([
          { projectId: created1.body.id, role: "LEADER", leftAt: null },
          { projectId: created2.body.id, role: "LEADER", leftAt: null },
        ]),
      );
      expect(await prisma.projectMember.count({ where: { userId: a.id } })).toBe(2);
      expect(await prisma.projectMember.count({ where: { userId: b.id } })).toBe(1);
    });

    it("사용자 A의 프로젝트가 여러 개이고 저장 순서와 생성 시각 순서가 뒤섞여 있을 때 목록을 조회하면 생성 시각 내림차순으로 온다", async () => {
      const { agent, user: a } = await loginAs("alice");
      const p2 = await seedProject(a.id, { name: "2", createdAt: at(2) });
      const p4 = await seedProject(a.id, { name: "4", createdAt: at(4) });
      const p1 = await seedProject(a.id, { name: "1", createdAt: at(1) });
      const p3 = await seedProject(a.id, { name: "3", createdAt: at(3) });
      const before = await snapshot();

      const res = await agent.get(PROJECTS);

      expect(res.status).toBe(200);
      expect(ids(res.body.items)).toEqual([p4.id, p3.id, p2.id, p1.id]);
      expect(res.body.items.map((item: Item) => item.createdAt)).toEqual([
        at(4).toISOString(),
        at(3).toISOString(),
        at(2).toISOString(),
        at(1).toISOString(),
      ]);
      expect(res.body.items.map((item: Item) => item.myRole)).toEqual(["LEADER", "LEADER", "LEADER", "LEADER"]);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("시나리오 2: 팀원(MEMBER)으로 속한 프로젝트", () => {
    it("사용자 A가 B의 프로젝트에 현재 팀원 기록(역할 MEMBER)을 갖고 있을 때 A가 목록을 조회하면 그 프로젝트도 myRole MEMBER와 B를 팀장으로 한 상세로 자기 프로젝트와 함께 생성 시각 내림차순으로 온다", async () => {
      const vue = await techStack("Vue");
      const designer = await position("디자이너");
      const { agent, user: a } = await loginAs("alice");
      const b = await seedUser("bob");
      const own = await seedProject(a.id, { name: "A의 프로젝트", createdAt: at(10) });
      const bProject = await seedProject(b.id, {
        name: "B의 프로젝트",
        techStacks: [vue],
        positions: [{ position: designer, capacity: 4 }],
        createdAt: at(20),
      });
      await seedMember(bProject.id, a.id);
      const before = await snapshot();

      const res = await agent.get(PROJECTS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [
          {
            id: bProject.id,
            name: "B의 프로젝트",
            description: "개발자 팀 매칭 플랫폼",
            duration: "M3_TO_6",
            meetingType: "ONLINE",
            leader: { id: b.id, nickname: "bob" },
            techStacks: [{ id: vue.id, name: "Vue" }],
            positions: [
              {
                id: await projectPositionId(bProject.id, designer.id),
                position: { id: designer.id, name: "디자이너" },
                capacity: 4,
              },
            ],
            createdAt: bProject.createdAt.toISOString(),
            updatedAt: bProject.updatedAt.toISOString(),
            myRole: "MEMBER",
          },
          {
            id: own.id,
            name: "A의 프로젝트",
            description: "개발자 팀 매칭 플랫폼",
            duration: "M3_TO_6",
            meetingType: "ONLINE",
            leader: { id: a.id, nickname: "alice" },
            techStacks: [],
            positions: [],
            createdAt: own.createdAt.toISOString(),
            updatedAt: own.updatedAt.toISOString(),
            myRole: "LEADER",
          },
        ],
      });
      expect(await snapshot()).toEqual(before);
    });

    it("사용자 A의 B 프로젝트 팀원 기록이 탈퇴·제외 처리돼(leftAt 있음) 있을 때 A가 목록을 조회하면 그 프로젝트는 오지 않고 현재 팀원 기록이 있는 프로젝트만 오며 기록은 그대로 남는다", async () => {
      const { agent, user: a } = await loginAs("alice");
      const b = await seedUser("bob");
      const leftProject = await seedProject(b.id, { name: "나간 프로젝트", createdAt: at(30) });
      const currentProject = await seedProject(b.id, { name: "속한 프로젝트", createdAt: at(10) });
      const leftAt = new Date("2026-11-10T00:00:00.000Z");
      await seedMember(leftProject.id, a.id, { leftAt });
      await seedMember(currentProject.id, a.id);
      const before = await snapshot();

      const res = await agent.get(PROJECTS);

      expect(res.status).toBe(200);
      expect(ids(res.body.items)).toEqual([currentProject.id]);
      expect(res.body.items[0]).toMatchObject({
        id: currentProject.id,
        name: "속한 프로젝트",
        leader: { id: b.id, nickname: "bob" },
        myRole: "MEMBER",
      });
      expect(
        await prisma.projectMember.findFirstOrThrow({ where: { projectId: leftProject.id, userId: a.id } }),
      ).toMatchObject({ role: "MEMBER", leftAt });
      expect(await snapshot()).toEqual(before);
    });

    it("사용자 A가 B의 프로젝트에 탈퇴·제외된 기록과 다시 합류한 현재 팀원 기록을 함께 갖고 있을 때 목록을 조회하면 그 프로젝트가 myRole MEMBER로 한 번만 온다", async () => {
      const { agent, user: a } = await loginAs("alice");
      const b = await seedUser("bob");
      const bProject = await seedProject(b.id, { name: "다시 합류한 프로젝트" });
      await seedMember(bProject.id, a.id, { leftAt: new Date("2026-11-05T00:00:00.000Z") });
      await seedMember(bProject.id, a.id);
      const before = await snapshot();

      const res = await agent.get(PROJECTS);

      expect(res.status).toBe(200);
      expect(ids(res.body.items)).toEqual([bProject.id]);
      expect(res.body.items[0]).toMatchObject({ id: bProject.id, leader: { id: b.id, nickname: "bob" }, myRole: "MEMBER" });
      expect(await prisma.projectMember.count({ where: { projectId: bProject.id, userId: a.id } })).toBe(2);
      expect(await snapshot()).toEqual(before);
    });

    it("사용자 A가 B 프로젝트의 포지션에 배정된 팀원이었고 그 마스터 포지션이 삭제돼 포지션 없음이 됐을 때 목록을 조회하면 그 프로젝트가 빈 포지션과 myRole MEMBER로 여전히 온다", async () => {
      const backend = await position("백엔드");
      const { agent, user: a } = await loginAs("alice");
      const b = await seedUser("bob");
      const bProject = await seedProject(b.id, { positions: [{ position: backend, capacity: 2 }] });
      await seedMember(bProject.id, a.id, { projectPositionId: await projectPositionId(bProject.id, backend.id) });
      // 관리자가 마스터 포지션을 삭제한 것처럼: 프로젝트 포지션은 함께 삭제되고 팀원 기록은 포지션만 없음이 된다
      await prisma.position.delete({ where: { id: backend.id } });
      expect(
        await prisma.projectMember.findFirstOrThrow({ where: { projectId: bProject.id, userId: a.id } }),
      ).toMatchObject({ role: "MEMBER", projectPositionId: null, leftAt: null });

      const res = await agent.get(PROJECTS);

      expect(res.status).toBe(200);
      expect(ids(res.body.items)).toEqual([bProject.id]);
      expect(res.body.items[0]).toMatchObject({
        id: bProject.id,
        leader: { id: b.id, nickname: "bob" },
        positions: [],
        myRole: "MEMBER",
      });
    });
  });

  describe("시나리오 3: 속한 프로젝트가 없음", () => {
    it("로그인한 사용자가 속한 프로젝트가 없고 다른 사용자의 프로젝트만 있을 때 목록을 조회하면 200과 { items: [] }가 오고 저장 상태는 바뀌지 않는다", async () => {
      const { agent, user } = await loginAs("alice");
      const b = await seedUser("bob");
      await seedProject(b.id, { name: "B의 첫 번째" });
      await seedProject(b.id, { name: "B의 두 번째" });
      const before = await snapshot();

      const res = await agent.get(PROJECTS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
      expect(await prisma.projectMember.count({ where: { userId: user.id } })).toBe(0);
      expect(await snapshot()).toEqual(before);
    });

    it("로그인한 사용자의 팀원 기록이 모두 탈퇴·제외 처리돼 있을 때 목록을 조회하면 200과 { items: [] }가 온다", async () => {
      const { agent, user } = await loginAs("alice");
      const b = await seedUser("bob");
      const bProject = await seedProject(b.id);
      await seedMember(bProject.id, user.id, { leftAt: new Date("2026-11-10T00:00:00.000Z") });
      const before = await snapshot();

      const res = await agent.get(PROJECTS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
      expect(await prisma.projectMember.count({ where: { userId: user.id, leftAt: null } })).toBe(0);
      expect(await snapshot()).toEqual(before);
    });

    it("프로젝트가 하나도 없는 상태에서 로그인한 사용자가 목록을 조회하면 200과 { items: [] }가 온다", async () => {
      const { agent } = await loginAs("alice");

      const res = await agent.get(PROJECTS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
      expect(await prisma.project.count()).toBe(0);
    });
  });

  describe("시나리오 4: 비로그인", () => {
    it("로그인하지 않은 상태로 프로젝트가 있을 때 목록을 조회하면 401이 오고 목록은 담기지 않으며 저장 상태는 바뀌지 않는다", async () => {
      const leader = await seedUser("leader");
      await seedProject(leader.id);
      const before = await snapshot();

      const res = await request(app).get(PROJECTS);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: expect.any(String) });
      expect(await snapshot()).toEqual(before);
    });

    it("로그인한 뒤 탈퇴 처리된 사용자의 세션으로 목록을 조회하면 비로그인과 같은 401이 온다", async () => {
      const { agent, user } = await loginAs("leader");
      await seedProject(user.id);
      await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
      const before = await snapshot();

      const res = await agent.get(PROJECTS);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: expect.any(String) });
      expect(await snapshot()).toEqual(before);
    });
  });
});
