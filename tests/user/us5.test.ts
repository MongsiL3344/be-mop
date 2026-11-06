import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const SIGNUP = "/users/signup";

const valid = { email: "alice@example.com", password: "password1", nickname: "alice" };

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US5 가입 시 일반 사용자 역할", () => {
  describe("시나리오 1: 기본 역할", () => {
    it("같은 이메일 계정이 없을 때 유효한 이메일·비밀번호·닉네임으로 가입하면 201 빈 본문을 받고 저장된 사용자의 역할은 USER다", async () => {
      const res = await request(app).post(SIGNUP).send(valid);

      expect(res.status).toBe(201);
      expect(res.text).toBe("");

      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0]?.email).toBe(valid.email);
      expect(users[0]?.role).toBe("USER");
    });
  });

  describe("시나리오 2: 가입 본문의 역할 무시", () => {
    it('같은 이메일 계정이 없을 때 유효한 가입 본문에 "role": "ADMIN"을 덧붙여 가입하면 201을 받고 역할은 무시되어 저장된 역할은 USER다', async () => {
      const res = await request(app).post(SIGNUP).send({ ...valid, role: "ADMIN" });

      expect(res.status).toBe(201);
      expect(res.text).toBe("");

      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0]?.email).toBe(valid.email);
      expect(users[0]?.role).toBe("USER");
    });

    // 엣지 케이스: role에 어떤 값(USER, 잘못된 값, 다른 타입)을 넣어도 400 없이 USER로 저장
    it.each([
      ["USER", "USER"],
      ["잘못된 문자열", "SUPERUSER"],
      ["소문자 admin", "admin"],
      ["숫자", 1],
      ["null", null],
      ["객체", { value: "ADMIN" }],
      ["배열", ["ADMIN"]],
    ])("같은 이메일 계정이 없을 때 가입 본문의 role이 %s이면 201을 받고 저장된 역할은 USER다", async (_label, role) => {
      const res = await request(app).post(SIGNUP).send({ ...valid, role });

      expect(res.status).toBe(201);
      expect(res.text).toBe("");

      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0]?.role).toBe("USER");
    });

    it('같은 이메일 계정이 없을 때 "role": "ADMIN"을 덧붙였지만 다른 필드가 규칙 위반이면 400이고 사용자는 저장되지 않는다', async () => {
      const res = await request(app).post(SIGNUP).send({ ...valid, nickname: "a", role: "ADMIN" });

      expect(res.status).toBe(400);
      expect(await prisma.user.count()).toBe(0);
    });
  });
});
