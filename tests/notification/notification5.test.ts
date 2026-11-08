import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LIST = "/notifications";
const LOGIN = "/users/login";

const alice = { email: "alice@example.com", password: "password1", nickname: "alice" };

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

// 로그인한 alice와 알림 3개를 준비한다
const setup = async () => {
  const a = await seedUser(alice);
  const rows = await seedNotifications(a.id, 3);
  const agent = request.agent(app);
  expect((await login(agent, alice)).status).toBe(200);
  return { agent, rows, before: await allNotifications() };
};

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User", "Notification" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("알림 목록 조회: 정의하지 않은 쿼리", () => {
  describe("시나리오 1: 정의하지 않은 쿼리 키만 보낼 때", () => {
    it("page=2처럼 정의하지 않은 쿼리 키로 조회하면 400 invalid request를 받고 알림은 노출되지 않으며 DB 알림은 바뀌지 않는다", async () => {
      const { agent, before } = await setup();

      const res = await agent.get(LIST).query({ page: 2 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid request");
      expect(res.body.items).toBeUndefined();
      expect(await allNotifications()).toEqual(before);
    });
  });

  describe("시나리오 2: 올바른 커서에 다른 키를 덧붙일 때", () => {
    it("본인 알림 id인 올바른 커서에 limit=50을 덧붙여 조회하면 400 invalid request를 받고 알림은 노출되지 않으며 DB 알림은 바뀌지 않는다", async () => {
      const { agent, rows, before } = await setup();
      const cursor = rows[2]?.id;
      expect(cursor).toBeDefined();

      const res = await agent.get(LIST).query({ cursor, limit: 50 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid request");
      expect(res.body.items).toBeUndefined();
      expect(await allNotifications()).toEqual(before);
    });
  });
});
