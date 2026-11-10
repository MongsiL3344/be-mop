import bcrypt from "bcrypt";
import request from "supertest";
import { ZodError } from "zod";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";
import { createNotification } from "../../src/lib/notification.js";

const LIST = "/notifications";
const LOGIN = "/users/login";

const alice = { email: "alice@example.com", password: "password1", nickname: "alice" };

// 존재하지 않는 유저 id
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

const seedUser = async (data: { email: string; password: string; nickname: string }, deletedAt: Date | null = null) => {
  const { password, ...rest } = data;
  return prisma.user.create({ data: { ...rest, passwordHash: await bcrypt.hash(password, 4), deletedAt } });
};

const allNotifications = () => prisma.notification.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User", "Notification" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("내부용 알림 생성 함수 createNotification", () => {
  describe("시나리오 1: 정상 저장", () => {
    it("탈퇴하지 않은 유저에게 알림을 만들면 안 읽은 알림이 저장되어 반환되고, 그 유저의 알림 목록 조회에 나온다", async () => {
      const a = await seedUser(alice);

      const created = await createNotification(a.id, "  새 댓글이 달렸어요  ");

      expect(created).toEqual({
        id: expect.any(String),
        content: "새 댓글이 달렸어요",
        readAt: null,
        createdAt: expect.any(Date),
      });
      expect(await allNotifications()).toEqual([
        { id: created.id, userId: a.id, content: "새 댓글이 달렸어요", readAt: null, createdAt: created.createdAt },
      ]);

      const agent = request.agent(app);
      expect((await agent.post(LOGIN).send({ email: alice.email, password: alice.password })).status).toBe(200);
      const res = await agent.get(LIST);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([
        { id: created.id, content: "새 댓글이 달렸어요", readAt: null, createdAt: created.createdAt.toISOString() },
      ]);
    });
  });

  describe("시나리오 2: 받을 수 없는 유저", () => {
    it("존재하지 않는 유저 id로 만들면 404 에러가 나고 알림은 저장되지 않는다", async () => {
      await seedUser(alice);

      await expect(createNotification(UNKNOWN_ID, "알림")).rejects.toMatchObject({
        status: 404,
        message: "유저를 찾을 수 없습니다",
      });
      expect(await allNotifications()).toEqual([]);
    });

    it("탈퇴한 유저에게 만들면 404 에러가 나고 알림은 저장되지 않는다", async () => {
      const a = await seedUser(alice, new Date());

      await expect(createNotification(a.id, "알림")).rejects.toMatchObject({
        status: 404,
        message: "유저를 찾을 수 없습니다",
      });
      expect(await allNotifications()).toEqual([]);
    });
  });

  describe("시나리오 3: 잘못된 입력", () => {
    it("내용이 빈 문자열이면 ZodError가 나고 알림은 저장되지 않는다", async () => {
      const a = await seedUser(alice);

      await expect(createNotification(a.id, "")).rejects.toBeInstanceOf(ZodError);
      expect(await allNotifications()).toEqual([]);
    });

    it("내용이 공백뿐이면 ZodError가 나고 알림은 저장되지 않는다", async () => {
      const a = await seedUser(alice);

      await expect(createNotification(a.id, "   ")).rejects.toBeInstanceOf(ZodError);
      expect(await allNotifications()).toEqual([]);
    });

    it("유저 id가 uuid 형식이 아니면 ZodError가 나고 알림은 저장되지 않는다", async () => {
      await seedUser(alice);

      await expect(createNotification("not-a-uuid", "알림")).rejects.toBeInstanceOf(ZodError);
      expect(await allNotifications()).toEqual([]);
    });
  });
});
