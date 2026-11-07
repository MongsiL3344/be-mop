import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LIST = "/notifications";
const LOGIN = "/users/login";
// service.ts의 한 페이지 개수
const PAGE_SIZE = 20;

const alice = { email: "alice@example.com", password: "password1", nickname: "alice" };

// 알림 생성 시각의 기준점: 1초 간격으로 쌓아 정렬 순서를 확정한다
const BASE = new Date("2026-01-01T00:00:00.000Z").getTime();

const seedUser = async (data: { email: string; password: string; nickname: string }) => {
  const { password, ...rest } = data;
  return prisma.user.create({ data: { ...rest, passwordHash: await bcrypt.hash(password, 4) } });
};

// sameTime이면 모든 알림의 생성 시각이 같다
const seedNotifications = (userId: string, count: number, sameTime = false) =>
  prisma.notification.createManyAndReturn({
    data: Array.from({ length: count }, (_, i) => ({
      userId,
      content: `알림 ${i + 1}`,
      createdAt: new Date(BASE + (sameTime ? 0 : i * 1000)),
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

const idsOf = (res: request.Response): string[] => res.body.items.map((n: { id: string }) => n.id);

// 로그인한 alice와 알림 count개를 준비한다
const setup = async (count: number, sameTime = false) => {
  const a = await seedUser(alice);
  const rows = await seedNotifications(a.id, count, sameTime);
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

describe("알림 목록 조회: 페이지네이션(20개씩)", () => {
  describe("시나리오 1: 첫 페이지", () => {
    it("알림이 25개일 때 커서 없이 조회하면 200과 최신 20개를 받고 nextCursor는 20번째 알림 id이며 DB 알림은 바뀌지 않는다", async () => {
      const { agent, rows, before } = await setup(25);
      const expected = newestFirst(rows).slice(0, PAGE_SIZE);

      const res = await agent.get(LIST);

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual(expected.map(toItem));
      expect(res.body.nextCursor).toBe(expected[PAGE_SIZE - 1]?.id);
      expect(await allNotifications()).toEqual(before);
    });
  });

  describe("시나리오 2: 다음 페이지", () => {
    it("알림이 25개일 때 첫 페이지의 nextCursor로 조회하면 200과 나머지 5개, nextCursor null을 받고 두 페이지를 합치면 겹침 없이 25개 전부이며 DB 알림은 바뀌지 않는다", async () => {
      const { agent, rows, before } = await setup(25);
      const first = await agent.get(LIST);
      expect(first.status).toBe(200);

      const res = await agent.get(LIST).query({ cursor: first.body.nextCursor });

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual(newestFirst(rows).slice(PAGE_SIZE).map(toItem));
      expect(res.body.nextCursor).toBeNull();

      const all = [...idsOf(first), ...idsOf(res)];
      expect(new Set(all).size).toBe(25);
      expect(all).toEqual(newestFirst(rows).map((n) => n.id));
      expect(await allNotifications()).toEqual(before);
    });
  });

  describe("시나리오 3: 정확히 20개(경계)", () => {
    it("알림이 정확히 20개일 때 조회하면 200과 20개를 받고 다음 페이지가 없으므로 nextCursor는 null이며 DB 알림은 바뀌지 않는다", async () => {
      const { agent, rows, before } = await setup(20);

      const res = await agent.get(LIST);

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual(newestFirst(rows).map(toItem));
      expect(res.body.nextCursor).toBeNull();
      expect(await allNotifications()).toEqual(before);
    });
  });

  describe("시나리오 4: 21개(경계)", () => {
    it("알림이 21개일 때 첫 페이지는 20개와 nextCursor를, 그 커서로 조회한 다음 페이지는 가장 오래된 1개와 nextCursor null을 받고 DB 알림은 바뀌지 않는다", async () => {
      const { agent, rows, before } = await setup(21);
      const sorted = newestFirst(rows);

      const first = await agent.get(LIST);
      expect(first.status).toBe(200);
      expect(first.body.items).toEqual(sorted.slice(0, PAGE_SIZE).map(toItem));
      expect(first.body.nextCursor).toBe(sorted[PAGE_SIZE - 1]?.id);

      const res = await agent.get(LIST).query({ cursor: first.body.nextCursor });

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual(sorted.slice(PAGE_SIZE).map(toItem));
      expect(res.body.nextCursor).toBeNull();
      expect(await allNotifications()).toEqual(before);
    });
  });

  describe("시나리오 5: 생성 시각이 같은 알림이 페이지 경계에 걸칠 때", () => {
    it("생성 시각이 모두 같은 알림 25개를 두 페이지로 나눠 조회하면 빠지거나 겹치는 알림 없이 25개 전부를 받고 DB 알림은 바뀌지 않는다", async () => {
      const { agent, rows, before } = await setup(25, true);

      const first = await agent.get(LIST);
      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(PAGE_SIZE);
      expect(typeof first.body.nextCursor).toBe("string");

      const res = await agent.get(LIST).query({ cursor: first.body.nextCursor });

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(5);
      expect(res.body.nextCursor).toBeNull();

      const all = [...idsOf(first), ...idsOf(res)];
      expect(new Set(all).size).toBe(25);
      expect([...all].sort()).toEqual(rows.map((n) => n.id).sort());
      expect(await allNotifications()).toEqual(before);
    });
  });
});
