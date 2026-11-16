import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LOGIN = "/users/login";
const ME = "/users/me";
const profileUrl = (id: string) => `/users/${id}`;

// 형식은 올바르지만 저장소에 없는 UUID
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

const alice = { email: "alice@example.com", password: "password1", nickname: "alice" };
const bob = { email: "bob@example.com", password: "password1", nickname: "bob" };

type SeedUserInput = {
  email: string;
  password: string;
  nickname: string;
  introduction?: string | null;
  links?: string[];
  deletedAt?: Date;
};

const seedUser = async (data: SeedUserInput) => {
  const { password, ...rest } = data;
  return prisma.user.create({ data: { ...rest, passwordHash: await bcrypt.hash(password, 4) } });
};

const seedPosition = (name: string) => prisma.position.create({ data: { name }, select: { id: true, name: true } });
const seedTechStack = (name: string) => prisma.techStack.create({ data: { name }, select: { id: true, name: true } });

// 사용자와 태그를 연결 테이블로 잇는다
const linkPositions = (userId: string, positionIds: string[]) =>
  prisma.userPosition.createMany({ data: positionIds.map((positionId) => ({ userId, positionId })) });
const linkTechStacks = (userId: string, techStackIds: string[]) =>
  prisma.userTechStack.createMany({ data: techStackIds.map((techStackId) => ({ userId, techStackId })) });

const login = (agent: { post(url: string): request.Test }, user: { email: string; password: string }) =>
  agent.post(LOGIN).send({ email: user.email, password: user.password });

// 조회 API가 DB를 바꾸지 않았는지 비교하기 위한 저장소 상태
const dbSnapshot = async () => ({
  users: await prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
  userPositions: await prisma.userPosition.findMany({ orderBy: [{ userId: "asc" }, { positionId: "asc" }] }),
  userTechStacks: await prisma.userTechStack.findMany({ orderBy: [{ userId: "asc" }, { techStackId: "asc" }] }),
  positions: await prisma.position.count(),
  techStacks: await prisma.techStack.count(),
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User", "TechStack", "Position" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US6 프로필 조회", () => {
  describe("시나리오 1: 정상 조회", () => {
    it("비로그인 상태에서 소개·링크·포지션·기술 스택이 있는 사용자를 조회하면 200과 명세 형태의 프로필을 받고 DB는 바뀌지 않는다", async () => {
      const user = await seedUser({
        ...alice,
        introduction: "백엔드 개발자입니다",
        links: ["https://github.com/alice", "https://alice.dev"],
      });
      const backend = await seedPosition("백엔드");
      const react = await seedTechStack("React");
      await linkPositions(user.id, [backend.id]);
      await linkTechStacks(user.id, [react.id]);
      const before = await dbSnapshot();

      const res = await request(app).get(profileUrl(user.id));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: user.id,
        nickname: "alice",
        introduction: "백엔드 개발자입니다",
        links: ["https://github.com/alice", "https://alice.dev"],
        positions: [{ id: backend.id, name: "백엔드" }],
        techStacks: [{ id: react.id, name: "React" }],
      });
      expect(await dbSnapshot()).toEqual(before);
    });

    it("프로필 응답에는 email·role·passwordHash·deletedAt·createdAt이 들어 있지 않고 DB는 바뀌지 않는다", async () => {
      const user = await seedUser(alice);
      const before = await dbSnapshot();

      const res = await request(app).get(profileUrl(user.id));

      expect(res.status).toBe(200);
      for (const field of ["email", "role", "passwordHash", "deletedAt", "createdAt"]) {
        expect(res.body).not.toHaveProperty(field);
      }
      expect(await dbSnapshot()).toEqual(before);
    });

    it("로그인한 사용자가 GET /users/me로 얻은 내 id로 조회하면 200과 내 프로필을 받고 DB는 바뀌지 않는다", async () => {
      const user = await seedUser({ ...alice, introduction: "안녕하세요" });
      await seedUser(bob);
      const agent = request.agent(app);
      expect((await login(agent, alice)).status).toBe(200);
      const meRes = await agent.get(ME);
      expect(meRes.status).toBe(200);
      const before = await dbSnapshot();

      const res = await agent.get(profileUrl(meRes.body.id));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: user.id,
        nickname: "alice",
        introduction: "안녕하세요",
        links: [],
        positions: [],
        techStacks: [],
      });
      expect(await dbSnapshot()).toEqual(before);
    });

    it("소개·링크·포지션·기술 스택이 없는 사용자를 조회하면 200과 introduction null, 나머지는 빈 배열을 받고 DB는 바뀌지 않는다", async () => {
      const user = await seedUser(alice);
      const before = await dbSnapshot();

      const res = await request(app).get(profileUrl(user.id));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: user.id,
        nickname: "alice",
        introduction: null,
        links: [],
        positions: [],
        techStacks: [],
      });
      expect(await dbSnapshot()).toEqual(before);
    });

    it("다른 사용자에게 연결된 포지션·기술 스택은 조회한 사용자의 프로필에 섞이지 않고 DB는 바뀌지 않는다", async () => {
      const a = await seedUser(alice);
      const b = await seedUser(bob);
      const backend = await seedPosition("백엔드");
      const frontend = await seedPosition("프론트엔드");
      const react = await seedTechStack("React");
      const spring = await seedTechStack("Spring");
      await linkPositions(a.id, [backend.id]);
      await linkTechStacks(a.id, [spring.id]);
      await linkPositions(b.id, [frontend.id]);
      await linkTechStacks(b.id, [react.id]);
      const before = await dbSnapshot();

      const res = await request(app).get(profileUrl(a.id));

      expect(res.status).toBe(200);
      expect(res.body.positions).toEqual([{ id: backend.id, name: "백엔드" }]);
      expect(res.body.techStacks).toEqual([{ id: spring.id, name: "Spring" }]);
      expect(await dbSnapshot()).toEqual(before);
    });
  });

  describe("시나리오 2: 정렬", () => {
    it("포지션·기술 스택은 태그 목록 API와 같이 대소문자를 무시한 이름 오름차순(영문이 한글보다 앞)으로 정렬되고 DB는 바뀌지 않는다", async () => {
      const user = await seedUser(alice);
      const frontend = await seedPosition("프론트엔드");
      const backend = await seedPosition("백엔드");
      const designer = await seedPosition("Designer");
      const vue = await seedTechStack("vue");
      const react = await seedTechStack("React");
      const angular = await seedTechStack("angular");
      await linkPositions(user.id, [frontend.id, backend.id, designer.id]);
      await linkTechStacks(user.id, [vue.id, react.id, angular.id]);
      const before = await dbSnapshot();

      const res = await request(app).get(profileUrl(user.id));

      expect(res.status).toBe(200);
      expect(res.body.positions).toEqual([
        { id: designer.id, name: "Designer" },
        { id: backend.id, name: "백엔드" },
        { id: frontend.id, name: "프론트엔드" },
      ]);
      expect(res.body.techStacks).toEqual([
        { id: angular.id, name: "angular" },
        { id: react.id, name: "React" },
        { id: vue.id, name: "vue" },
      ]);
      expect(await dbSnapshot()).toEqual(before);
    });
  });

  describe("시나리오 3: 에러", () => {
    it.each([
      ["영문 문자열", "abc"],
      ["숫자", "123"],
      ["하이픈 없는 UUID", "00000000000040008000000000000000"],
      ["한 글자 모자란 UUID", "00000000-0000-4000-8000-00000000000"],
      ["한 글자 넘치는 UUID", "00000000-0000-4000-8000-0000000000000"],
    ])("id가 UUID 형식이 아니면(%s) 400을 받고 DB는 바뀌지 않는다", async (_label, id) => {
      await seedUser(alice);
      const before = await dbSnapshot();

      const res = await request(app).get(profileUrl(id));

      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe("string");
      expect(await dbSnapshot()).toEqual(before);
    });

    it("형식은 올바르지만 없는 사용자의 id로 조회하면 404를 받고 DB는 바뀌지 않는다", async () => {
      await seedUser(alice);
      const before = await dbSnapshot();

      const res = await request(app).get(profileUrl(MISSING_ID));

      expect(res.status).toBe(404);
      expect(typeof res.body.error).toBe("string");
      expect(await dbSnapshot()).toEqual(before);
    });

    it("탈퇴한 사용자의 id로 조회하면 없는 사용자와 같은 404 응답을 받고 DB는 바뀌지 않는다", async () => {
      const withdrawn = await seedUser({ ...alice, deletedAt: new Date() });
      const before = await dbSnapshot();

      const res = await request(app).get(profileUrl(withdrawn.id));
      const missingRes = await request(app).get(profileUrl(MISSING_ID));

      expect(res.status).toBe(404);
      expect(res.body).toEqual(missingRes.body);
      expect(await dbSnapshot()).toEqual(before);
    });
  });

  describe("시나리오 4: GET /users/me 유지", () => {
    it("로그인 후 GET /users/me를 호출하면 여전히 200과 id·email·nickname만 받고 DB는 바뀌지 않는다", async () => {
      const user = await seedUser({ ...alice, introduction: "소개", links: ["https://github.com/alice"] });
      const agent = request.agent(app);
      expect((await login(agent, alice)).status).toBe(200);
      const before = await dbSnapshot();

      const res = await agent.get(ME);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: user.id, email: alice.email, nickname: alice.nickname });
      expect(await dbSnapshot()).toEqual(before);
    });

    it("비로그인 상태로 GET /users/me를 호출하면 프로필 조회로 넘어가지 않고 401을 받으며 DB는 바뀌지 않는다", async () => {
      await seedUser(alice);
      const before = await dbSnapshot();

      const res = await request(app).get(ME);

      expect(res.status).toBe(401);
      expect(typeof res.body.error).toBe("string");
      expect(await dbSnapshot()).toEqual(before);
    });
  });
});
