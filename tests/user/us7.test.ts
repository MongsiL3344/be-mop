import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LOGIN = "/users/login";
const ME = "/users/me";
const profileUrl = (id: string) => `/users/${id}`;

// 형식은 올바르지만 저장소에 없는 UUID
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const INVALID_REQUEST = "invalid request";
const TAG_NOT_FOUND = "존재하지 않는 태그가 있어요";

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

// 로그인 세션을 유지하는 agent
const loginAgent = async (user: { email: string; password: string }) => {
  const agent = request.agent(app);
  expect((await login(agent, user)).status).toBe(200);
  return agent;
};

// 한 사용자의 저장 상태. 연결된 태그 ID는 정렬해서 비교한다
const userState = async (id: string) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id },
    select: { email: true, nickname: true, introduction: true, links: true, role: true, passwordHash: true },
  });
  const techStackIds = (await prisma.userTechStack.findMany({ where: { userId: id } })).map((l) => l.techStackId);
  const positionIds = (await prisma.userPosition.findMany({ where: { userId: id } })).map((l) => l.positionId);
  return { ...user, techStackIds: techStackIds.sort(), positionIds: positionIds.sort() };
};

// 저장소 전체 상태. 실패한 요청이 아무것도 바꾸지 않았는지 비교한다
const dbSnapshot = async () => ({
  users: await prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
  userPositions: await prisma.userPosition.findMany({ orderBy: [{ userId: "asc" }, { positionId: "asc" }] }),
  userTechStacks: await prisma.userTechStack.findMany({ orderBy: [{ userId: "asc" }, { techStackId: "asc" }] }),
  positions: await prisma.position.count(),
  techStacks: await prisma.techStack.count(),
});

const sorted = (ids: string[]) => [...ids].sort();

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users", "tech_stacks", "positions" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US7 프로필 수정", () => {
  describe("시나리오 1: 정상 수정", () => {
    it("모든 필드를 보내면 200과 GET /users/:id와 같은 프로필을 받고 DB에 반영된다", async () => {
      const user = await seedUser(alice);
      const backend = await seedPosition("백엔드");
      const react = await seedTechStack("React");
      const agent = await loginAgent(alice);

      const res = await agent.patch(ME).send({
        nickname: "몽실",
        introduction: "백엔드 개발자입니다",
        links: ["https://github.com/alice", "http://alice.dev"],
        techStackIds: [react.id],
        positionIds: [backend.id],
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: user.id,
        nickname: "몽실",
        introduction: "백엔드 개발자입니다",
        links: ["https://github.com/alice", "http://alice.dev"],
        positions: [{ id: backend.id, name: "백엔드" }],
        techStacks: [{ id: react.id, name: "React" }],
      });
      expect(res.body).toEqual((await request(app).get(profileUrl(user.id))).body);
      const state = await userState(user.id);
      expect(state).toMatchObject({
        nickname: "몽실",
        introduction: "백엔드 개발자입니다",
        links: ["https://github.com/alice", "http://alice.dev"],
        techStackIds: [react.id],
        positionIds: [backend.id],
      });
    });

    it("닉네임은 앞뒤 공백을 제거해 저장한다", async () => {
      const user = await seedUser(alice);
      const agent = await loginAgent(alice);

      const res = await agent.patch(ME).send({ nickname: "  몽실  " });

      expect(res.status).toBe(200);
      expect(res.body.nickname).toBe("몽실");
      expect((await userState(user.id)).nickname).toBe("몽실");
    });

    it("닉네임만 보내면 소개·링크·태그 연결은 그대로다", async () => {
      const user = await seedUser({ ...alice, introduction: "소개", links: ["https://github.com/alice"] });
      const backend = await seedPosition("백엔드");
      const react = await seedTechStack("React");
      await linkPositions(user.id, [backend.id]);
      await linkTechStacks(user.id, [react.id]);
      const agent = await loginAgent(alice);
      const before = await userState(user.id);

      const res = await agent.patch(ME).send({ nickname: "몽실" });

      expect(res.status).toBe(200);
      expect(await userState(user.id)).toEqual({ ...before, nickname: "몽실" });
    });

    it("태그만 보내면 닉네임·소개·링크는 그대로다", async () => {
      const user = await seedUser({ ...alice, introduction: "소개", links: ["https://github.com/alice"] });
      const react = await seedTechStack("React");
      const agent = await loginAgent(alice);
      const before = await userState(user.id);

      const res = await agent.patch(ME).send({ techStackIds: [react.id] });

      expect(res.status).toBe(200);
      expect(await userState(user.id)).toEqual({ ...before, techStackIds: [react.id] });
    });

    it("빈 본문을 보내면 200과 현재 프로필을 받고 DB는 바뀌지 않는다", async () => {
      const user = await seedUser({ ...alice, introduction: "소개" });
      const agent = await loginAgent(alice);
      const before = await dbSnapshot();

      const res = await agent.patch(ME).send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual((await request(app).get(profileUrl(user.id))).body);
      expect(await dbSnapshot()).toEqual(before);
    });

    it("내 현재 닉네임을 그대로 보내면 200이다", async () => {
      const user = await seedUser(alice);
      const agent = await loginAgent(alice);

      const res = await agent.patch(ME).send({ nickname: "alice", introduction: "안녕" });

      expect(res.status).toBe(200);
      expect(await userState(user.id)).toMatchObject({ nickname: "alice", introduction: "안녕" });
    });

    it("응답의 포지션·기술 스택은 대소문자를 무시한 이름 오름차순(영문이 한글보다 앞)이다", async () => {
      const user = await seedUser(alice);
      const frontend = await seedPosition("프론트엔드");
      const backend = await seedPosition("백엔드");
      const designer = await seedPosition("Designer");
      const vue = await seedTechStack("vue");
      const react = await seedTechStack("React");
      const angular = await seedTechStack("angular");
      const agent = await loginAgent(alice);

      const res = await agent.patch(ME).send({
        positionIds: [frontend.id, backend.id, designer.id],
        techStackIds: [vue.id, react.id, angular.id],
      });

      expect(res.status).toBe(200);
      expect(res.body.positions).toEqual([designer, backend, frontend]);
      expect(res.body.techStacks).toEqual([angular, react, vue]);
      expect(await userState(user.id)).toMatchObject({
        positionIds: sorted([frontend.id, backend.id, designer.id]),
        techStackIds: sorted([vue.id, react.id, angular.id]),
      });
    });

    it("소개는 문자 수 기준이라 이모지 100자도 저장된다", async () => {
      const user = await seedUser(alice);
      const agent = await loginAgent(alice);
      const introduction = "😀".repeat(100);

      const res = await agent.patch(ME).send({ introduction });

      expect(res.status).toBe(200);
      expect((await userState(user.id)).introduction).toBe(introduction);
    });
  });

  describe("시나리오 2: 비우기와 교체", () => {
    it.each([
      ["null", null],
      ["빈 문자열", ""],
      ["공백만", "   "],
    ])("소개에 %s을 보내면 null로 저장된다", async (_label, introduction) => {
      const user = await seedUser({ ...alice, introduction: "기존 소개" });
      const agent = await loginAgent(alice);

      const res = await agent.patch(ME).send({ introduction });

      expect(res.status).toBe(200);
      expect(res.body.introduction).toBeNull();
      expect((await userState(user.id)).introduction).toBeNull();
    });

    it("기술 스택·포지션에 []을 보내면 연결이 모두 해제된다", async () => {
      const user = await seedUser(alice);
      const backend = await seedPosition("백엔드");
      const react = await seedTechStack("React");
      await linkPositions(user.id, [backend.id]);
      await linkTechStacks(user.id, [react.id]);
      const agent = await loginAgent(alice);

      const res = await agent.patch(ME).send({ techStackIds: [], positionIds: [] });

      expect(res.status).toBe(200);
      expect(res.body.techStacks).toEqual([]);
      expect(res.body.positions).toEqual([]);
      expect(await userState(user.id)).toMatchObject({ techStackIds: [], positionIds: [] });
      expect(await prisma.techStack.count()).toBe(1);
      expect(await prisma.position.count()).toBe(1);
    });

    it("링크에 []을 보내면 빈 목록으로 저장된다", async () => {
      const user = await seedUser({ ...alice, links: ["https://github.com/alice"] });
      const agent = await loginAgent(alice);

      const res = await agent.patch(ME).send({ links: [] });

      expect(res.status).toBe(200);
      expect(res.body.links).toEqual([]);
      expect((await userState(user.id)).links).toEqual([]);
    });

    it("태그 목록은 추가가 아니라 전체 교체된다", async () => {
      const user = await seedUser(alice);
      const a = await seedTechStack("A");
      const b = await seedTechStack("B");
      const c = await seedTechStack("C");
      await linkTechStacks(user.id, [a.id, b.id]);
      const agent = await loginAgent(alice);

      const res = await agent.patch(ME).send({ techStackIds: [b.id, c.id] });

      expect(res.status).toBe(200);
      expect(res.body.techStacks).toEqual([b, c]);
      expect((await userState(user.id)).techStackIds).toEqual(sorted([b.id, c.id]));
    });

    it("내 연결을 교체해도 다른 사용자의 연결은 바뀌지 않는다", async () => {
      const a = await seedUser(alice);
      const b = await seedUser(bob);
      const backend = await seedPosition("백엔드");
      const react = await seedTechStack("React");
      const spring = await seedTechStack("Spring");
      await linkTechStacks(a.id, [react.id]);
      await linkTechStacks(b.id, [react.id]);
      await linkPositions(b.id, [backend.id]);
      const agent = await loginAgent(alice);
      const bobBefore = await userState(b.id);

      const res = await agent.patch(ME).send({ techStackIds: [spring.id], positionIds: [] });

      expect(res.status).toBe(200);
      expect((await userState(a.id)).techStackIds).toEqual([spring.id]);
      expect(await userState(b.id)).toEqual(bobBefore);
    });
  });

  describe("시나리오 3: 수정할 수 없는 필드", () => {
    it("email·role·password를 보내도 무시되고 기존 비밀번호로 계속 로그인된다", async () => {
      const user = await seedUser(alice);
      const agent = await loginAgent(alice);
      const before = await userState(user.id);

      const res = await agent
        .patch(ME)
        .send({ email: "evil@example.com", role: "ADMIN", password: "newpassword1", introduction: "안녕" });

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty("email");
      expect(res.body).not.toHaveProperty("role");
      expect(await userState(user.id)).toEqual({ ...before, introduction: "안녕" });
      expect((await login(request.agent(app), alice)).status).toBe(200);
    });
  });

  describe("시나리오 4: 401", () => {
    it("비로그인 상태로 수정하면 401을 받고 DB는 바뀌지 않는다", async () => {
      await seedUser(alice);
      const before = await dbSnapshot();

      const res = await request(app).patch(ME).send({ nickname: "몽실" });

      expect(res.status).toBe(401);
      expect(typeof res.body.error).toBe("string");
      expect(await dbSnapshot()).toEqual(before);
    });

    it("로그인 후 탈퇴 처리된 사용자가 수정하면 401을 받고 DB는 바뀌지 않는다", async () => {
      const user = await seedUser(alice);
      const agent = await loginAgent(alice);
      await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
      const before = await dbSnapshot();

      const res = await agent.patch(ME).send({ nickname: "몽실" });

      expect(res.status).toBe(401);
      expect(typeof res.body.error).toBe("string");
      expect(await dbSnapshot()).toEqual(before);
    });

    it("비로그인이면서 본문 형식도 틀리면 400이 아니라 401이다", async () => {
      await seedUser(alice);
      const before = await dbSnapshot();

      const res = await request(app).patch(ME).send({ nickname: "a", links: ["ftp://x.com"] });

      expect(res.status).toBe(401);
      expect(await dbSnapshot()).toEqual(before);
    });
  });

  describe("시나리오 5: 400 형식 오류", () => {
    const manyIds = (count: number) => Array.from({ length: count }, () => randomUUID());

    it.each([
      ["닉네임 1자", { nickname: "a" }],
      ["닉네임 21자", { nickname: "a".repeat(21) }],
      ["닉네임 공백만", { nickname: "    " }],
      ["닉네임 숫자 타입", { nickname: 123 }],
      ["소개 101자", { introduction: "a".repeat(101) }],
      ["링크 6개", { links: Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`) }],
      ["링크 ftp", { links: ["ftp://example.com"] }],
      ["링크 javascript", { links: ["javascript:alert(1)"] }],
      ["링크 URL 아님", { links: ["github.com/alice"] }],
      ["기술 스택 21개", { techStackIds: manyIds(21) }],
      ["포지션 11개", { positionIds: manyIds(11) }],
      ["UUID 형식 아님", { techStackIds: ["abc"] }],
      ["같은 ID 중복", { positionIds: [MISSING_ID, MISSING_ID] }],
      ["태그 목록 null", { techStackIds: null }],
    ])("%s이면 400을 받고 DB는 바뀌지 않는다", async (_label, body) => {
      const user = await seedUser({ ...alice, introduction: "소개" });
      const react = await seedTechStack("React");
      await linkTechStacks(user.id, [react.id]);
      const agent = await loginAgent(alice);
      const before = await dbSnapshot();

      const res = await agent.patch(ME).send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(INVALID_REQUEST);
      expect(await dbSnapshot()).toEqual(before);
    });
  });

  describe("시나리오 6: 400 존재하지 않는 태그", () => {
    it("기술 스택에 없는 ID가 하나라도 섞이면 400을 받고 기존 연결은 그대로다", async () => {
      const user = await seedUser(alice);
      const react = await seedTechStack("React");
      const spring = await seedTechStack("Spring");
      await linkTechStacks(user.id, [react.id]);
      const agent = await loginAgent(alice);
      const before = await dbSnapshot();

      const res = await agent.patch(ME).send({ techStackIds: [spring.id, MISSING_ID] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(TAG_NOT_FOUND);
      expect(await dbSnapshot()).toEqual(before);
    });

    it("포지션에 없는 ID가 섞이면 400을 받고 DB는 바뀌지 않는다", async () => {
      await seedUser(alice);
      const backend = await seedPosition("백엔드");
      const agent = await loginAgent(alice);
      const before = await dbSnapshot();

      const res = await agent.patch(ME).send({ positionIds: [backend.id, MISSING_ID] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(TAG_NOT_FOUND);
      expect(await dbSnapshot()).toEqual(before);
    });

    it("없는 태그와 함께 보낸 닉네임·소개·링크도 바뀌지 않는다", async () => {
      await seedUser({ ...alice, introduction: "기존 소개" });
      const react = await seedTechStack("React");
      const agent = await loginAgent(alice);
      const before = await dbSnapshot();

      const res = await agent.patch(ME).send({
        nickname: "몽실",
        introduction: "바뀌면 안 됨",
        links: ["https://github.com/alice"],
        techStackIds: [react.id],
        positionIds: [MISSING_ID],
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(TAG_NOT_FOUND);
      expect(await dbSnapshot()).toEqual(before);
    });
  });

  describe("시나리오 7: 409 닉네임 중복", () => {
    it("다른 활성 사용자의 닉네임으로 바꾸면 409를 받고 DB는 바뀌지 않는다", async () => {
      await seedUser(alice);
      await seedUser(bob);
      const agent = await loginAgent(alice);
      const before = await dbSnapshot();

      const res = await agent.patch(ME).send({ nickname: "bob" });

      expect(res.status).toBe(409);
      expect(typeof res.body.error).toBe("string");
      expect(await dbSnapshot()).toEqual(before);
    });

    it("409이면 함께 보낸 소개와 태그 연결도 바뀌지 않는다", async () => {
      const user = await seedUser({ ...alice, introduction: "기존 소개" });
      await seedUser(bob);
      const react = await seedTechStack("React");
      const spring = await seedTechStack("Spring");
      await linkTechStacks(user.id, [react.id]);
      const agent = await loginAgent(alice);
      const before = await dbSnapshot();

      const res = await agent
        .patch(ME)
        .send({ nickname: "bob", introduction: "바뀌면 안 됨", techStackIds: [spring.id] });

      expect(res.status).toBe(409);
      expect(await dbSnapshot()).toEqual(before);
    });

    it("탈퇴한 사용자의 닉네임은 사용할 수 있다", async () => {
      const user = await seedUser(alice);
      await seedUser({ ...bob, deletedAt: new Date() });
      const agent = await loginAgent(alice);

      const res = await agent.patch(ME).send({ nickname: "bob" });

      expect(res.status).toBe(200);
      expect(res.body.nickname).toBe("bob");
      expect((await userState(user.id)).nickname).toBe("bob");
    });
  });

  describe("시나리오 8: 검사 순서", () => {
    it("형식 오류와 닉네임 중복이 함께 있으면 형식 오류 400이다", async () => {
      await seedUser(alice);
      await seedUser(bob);
      const agent = await loginAgent(alice);
      const before = await dbSnapshot();

      const res = await agent.patch(ME).send({ nickname: "bob", links: ["ftp://example.com"] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(INVALID_REQUEST);
      expect(await dbSnapshot()).toEqual(before);
    });

    it("없는 태그와 닉네임 중복이 함께 있으면 태그 400이다", async () => {
      await seedUser(alice);
      await seedUser(bob);
      const agent = await loginAgent(alice);
      const before = await dbSnapshot();

      const res = await agent.patch(ME).send({ nickname: "bob", techStackIds: [MISSING_ID] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(TAG_NOT_FOUND);
      expect(await dbSnapshot()).toEqual(before);
    });

    it("형식 오류와 없는 태그가 함께 있으면 형식 오류 400이다", async () => {
      await seedUser(alice);
      const agent = await loginAgent(alice);
      const before = await dbSnapshot();

      const res = await agent.patch(ME).send({ techStackIds: [MISSING_ID], links: ["ftp://example.com"] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(INVALID_REQUEST);
      expect(await dbSnapshot()).toEqual(before);
    });
  });

  describe("시나리오 9: 동시 요청", () => {
    it("두 사용자가 같은 닉네임으로 동시에 바꾸면 하나는 200, 하나는 409이고 5xx는 없다", async () => {
      await seedUser(alice);
      await seedUser(bob);
      const aliceAgent = await loginAgent(alice);
      const bobAgent = await loginAgent(bob);

      const results = await Promise.all([
        aliceAgent.patch(ME).send({ nickname: "몽실" }),
        bobAgent.patch(ME).send({ nickname: "몽실" }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.user.count({ where: { nickname: "몽실" } })).toBe(1);
    });

    it("같은 사용자가 다른 태그 목록으로 동시에 두 번 바꾸면 둘 다 200이고 최종 연결은 둘 중 한 목록과 정확히 같다", async () => {
      const user = await seedUser(alice);
      const react = await seedTechStack("React");
      const vue = await seedTechStack("vue");
      const spring = await seedTechStack("Spring");
      const agent = await loginAgent(alice);
      const first = sorted([react.id, vue.id]);
      const second = sorted([react.id, spring.id]);

      const results = await Promise.all([
        agent.patch(ME).send({ techStackIds: first }),
        agent.patch(ME).send({ techStackIds: second }),
      ]);

      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect([first, second]).toContainEqual((await userState(user.id)).techStackIds);
    });
  });

  describe("시나리오 10: 기존 API 유지", () => {
    it("수정 후 GET /users/me는 여전히 id·email·nickname만 바뀐 닉네임으로 반환한다", async () => {
      const user = await seedUser(alice);
      const agent = await loginAgent(alice);
      expect((await agent.patch(ME).send({ nickname: "몽실", introduction: "소개" })).status).toBe(200);
      const before = await dbSnapshot();

      const res = await agent.get(ME);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: user.id, email: alice.email, nickname: "몽실" });
      expect(await dbSnapshot()).toEqual(before);
    });
  });
});
