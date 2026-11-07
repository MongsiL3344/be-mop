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

// offset: 다른 사용자 알림과 생성 시각이 섞이도록 시작 위치(초)를 밀어준다
const seedNotifications = (userId: string, count: number, offset = 0) =>
  prisma.notification.createManyAndReturn({
    data: Array.from({ length: count }, (_, i) => ({
      userId,
      content: `알림 ${i + 1}`,
      createdAt: new Date(BASE + (offset + i * 2) * 1000),
    })),
  });

const allNotifications = () => prisma.notification.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

const login = (agent: { post(url: string): request.Test }, user: { email: string; password: string }) =>
  agent.post(LOGIN).send({ email: user.email, password: user.password });

// DB 알림 → API 응답 형태(JSON 직렬화 후)
const toItem = (n: { id: string; content: string; readAt: Date | null; createdAt: Date }) => ({
  id: n.id,
  content: n.content,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

// 최신순(생성 시각 내림차순)으로 정렬한 복사본
const newestFirst = <T extends { createdAt: Date }>(rows: T[]) =>
  [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User", "Notification" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("알림 목록 조회: 본인 알림만", () => {
  describe("시나리오 1: 다른 사용자의 알림과 섞여 있을 때", () => {
    it("alice 알림 3개와 bob 알림 2개가 있을 때 alice가 조회하면 200과 alice 알림 3개만 최신순으로 받고 nextCursor는 null이며 DB 알림은 바뀌지 않는다", async () => {
      const a = await seedUser(alice);
      const b = await seedUser(bob);
      const aliceRows = await seedNotifications(a.id, 3, 0);
      const bobRows = await seedNotifications(b.id, 2, 1);
      const agent = request.agent(app);
      expect((await login(agent, alice)).status).toBe(200);
      const before = await allNotifications();

      const res = await agent.get(LIST);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: newestFirst(aliceRows).map(toItem), nextCursor: null });
      const ids: string[] = res.body.items.map((n: { id: string }) => n.id);
      for (const row of bobRows) expect(ids).not.toContain(row.id);

      const after = await allNotifications();
      expect(after).toEqual(before);
      expect(after).toHaveLength(5);
      expect(after.every((n) => n.readAt === null)).toBe(true);
    });
  });

  describe("시나리오 2: 본인 알림이 없을 때", () => {
    it("alice 알림은 없고 bob 알림만 2개 있을 때 alice가 조회하면 200과 빈 목록, nextCursor null을 받고 DB 알림은 바뀌지 않는다", async () => {
      await seedUser(alice);
      const b = await seedUser(bob);
      await seedNotifications(b.id, 2);
      const agent = request.agent(app);
      expect((await login(agent, alice)).status).toBe(200);
      const before = await allNotifications();

      const res = await agent.get(LIST);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
      expect(await allNotifications()).toEqual(before);
    });
  });

  describe("시나리오 3: 응답 필드", () => {
    it("읽은 알림과 안 읽은 알림이 있을 때 조회하면 각 알림에 id·content·readAt·createdAt만 담기고 userId는 담기지 않으며 DB 알림은 바뀌지 않는다", async () => {
      const a = await seedUser(alice);
      const [first] = await seedNotifications(a.id, 2);
      const readAt = new Date(BASE + 60 * 1000);
      if (first) await prisma.notification.update({ where: { id: first.id }, data: { readAt } });
      const agent = request.agent(app);
      expect((await login(agent, alice)).status).toBe(200);
      const before = await allNotifications();

      const res = await agent.get(LIST);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      for (const item of res.body.items) {
        expect(Object.keys(item).sort()).toEqual(["content", "createdAt", "id", "readAt"]);
      }
      expect(res.body.items).toEqual(newestFirst(before).map(toItem));
      // 읽은 알림은 readAt이 ISO 문자열, 안 읽은 알림은 null
      expect(res.body.items.map((n: { readAt: string | null }) => n.readAt)).toEqual([null, readAt.toISOString()]);

      expect(await allNotifications()).toEqual(before);
    });
  });
});
