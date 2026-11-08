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

const expectUnauthorized = (res: request.Response) => {
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ error: "인증되지 않은 사용자입니다" });
};

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User", "Notification" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("알림 목록 조회: 인증", () => {
  describe("시나리오 1: 로그인하지 않은 요청", () => {
    it("알림이 있는 사용자가 있을 때 세션 쿠키 없이 알림 목록을 조회하면 401을 받고 알림은 노출되지 않으며 DB 알림은 바뀌지 않는다", async () => {
      const user = await seedUser(alice);
      await seedNotifications(user.id, 2);
      const before = await allNotifications();

      const res = await request(app).get(LIST);

      expectUnauthorized(res);
      expect(res.body.items).toBeUndefined();
      expect(await allNotifications()).toEqual(before);
    });
  });

  describe("시나리오 2: 로그인 중 탈퇴 처리된 사용자", () => {
    it("로그인 상태였으나 그 사이 사용자에게 삭제 시각이 기록된 뒤 알림 목록을 조회하면 401을 받고 그 사용자의 알림은 노출되지 않으며 DB 알림은 바뀌지 않는다", async () => {
      const user = await seedUser(alice);
      await seedNotifications(user.id, 2);
      const agent = request.agent(app);
      expect((await login(agent, alice)).status).toBe(200);
      expect((await agent.get(LIST)).status).toBe(200);

      await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
      const before = await allNotifications();

      const res = await agent.get(LIST);

      expectUnauthorized(res);
      expect(res.body.items).toBeUndefined();
      expect(await allNotifications()).toEqual(before);
    });
  });
});
