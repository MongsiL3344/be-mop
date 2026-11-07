import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LIST = "/notifications";
const LOGIN = "/users/login";

const alice = { email: "alice@example.com", password: "password1", nickname: "alice" };
const bob = { email: "bob@example.com", password: "password1", nickname: "bob" };

// 알림 생성 시각의 기준점: 1초 간격으로 쌓아 정렬 순서를 확정한다
const BASE = new Date("2026-01-01T00:00:00.000Z").getTime();

const seedUser = async (data: { email: string; password: string; nickname: string }) => {
  const { password, ...rest } = data;
  return prisma.user.create({ data: { ...rest, passwordHash: await bcrypt.hash(password, 4) } });
};

const seedNotifications = (userId: string, count: number) =>
  prisma.notification.createManyAndReturn({
    data: Array.from({ length: count }, (_, i) => ({
      userId,
      content: `알림 ${i + 1}`,
      createdAt: new Date(BASE + i * 1000),
    })),
  });

const allNotifications = () => prisma.notification.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

const login = (agent: { post(url: string): request.Test }, user: { email: string; password: string }) =>
  agent.post(LOGIN).send({ email: user.email, password: user.password });

// 로그인한 alice(알림 3개)와 bob(알림 2개)을 준비한다
const setup = async () => {
  const a = await seedUser(alice);
  const b = await seedUser(bob);
  await seedNotifications(a.id, 3);
  const bobRows = await seedNotifications(b.id, 2);
  const agent = request.agent(app);
  expect((await login(agent, alice)).status).toBe(200);
  return { agent, bobRows, before: await allNotifications() };
};

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User", "Notification" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("알림 목록 조회: 커서 오류", () => {
  describe("시나리오 1: 커서 형식 오류", () => {
    it("커서가 UUID 형식이 아닌 값(abc)이면 400 invalid request를 받고 알림은 노출되지 않으며 DB 알림은 바뀌지 않는다", async () => {
      const { agent, before } = await setup();

      const res = await agent.get(LIST).query({ cursor: "abc" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid request");
      expect(res.body.items).toBeUndefined();
      expect(await allNotifications()).toEqual(before);
    });

    it("커서가 빈 값(cursor=)이면 400 invalid request를 받고 알림은 노출되지 않으며 DB 알림은 바뀌지 않는다", async () => {
      const { agent, before } = await setup();

      const res = await agent.get(`${LIST}?cursor=`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid request");
      expect(res.body.items).toBeUndefined();
      expect(await allNotifications()).toEqual(before);
    });
  });

  describe("시나리오 2: 형식은 맞지만 쓸 수 없는 커서", () => {
    it("커서가 존재하지 않는 알림의 UUID면 400 유효하지 않은 커서입니다를 받고 DB 알림은 바뀌지 않는다", async () => {
      const { agent, before } = await setup();

      const res = await agent.get(LIST).query({ cursor: randomUUID() });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "유효하지 않은 커서입니다" });
      expect(await allNotifications()).toEqual(before);
    });

    it("alice가 bob의 알림 id를 커서로 조회하면 400 유효하지 않은 커서입니다를 받고 bob의 알림은 노출되지 않으며 DB 알림은 바뀌지 않는다", async () => {
      const { agent, bobRows, before } = await setup();
      const bobCursor = bobRows[0]?.id;
      expect(bobCursor).toBeDefined();

      const res = await agent.get(LIST).query({ cursor: bobCursor });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "유효하지 않은 커서입니다" });
      expect(await allNotifications()).toEqual(before);
    });
  });
});
