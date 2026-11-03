import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const SIGNUP = "/users/signup";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const valid = { email: "alice@example.com", password: "password1", nickname: "alice" };

const seedUser = async (data: { email: string; nickname: string; deletedAt?: Date }) =>
  prisma.user.create({ data: { ...data, passwordHash: await bcrypt.hash("existing1", 4) } });

const expectNoSecret = (res: request.Response, ...secrets: string[]) => {
  const dump = res.text + JSON.stringify(res.headers);
  for (const s of secrets) expect(dump).not.toContain(s);
};

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US1 회원가입", () => {
  describe("시나리오 1: 성공", () => {
    it("같은 이메일 계정이 없을 때 유효한 값으로 가입하면 201 빈 본문을 받고 사용자가 UUID와 복원 불가능한 해시 비밀번호로 저장되며 로그인 쿠키는 발급되지 않는다", async () => {
      const res = await request(app).post(SIGNUP).send(valid);

      // 회원가입 성공시 201에 빈 본문, 쿠키 없음
      expect(res.status).toBe(201);
      expect(res.text).toBe("");
      expect(res.headers["set-cookie"]).toBeUndefined();

      // 유저의 수가 +1 되어야함
      // 유저의 모든 필드가 요청 바디와 같아야함, 저장되는 비밀번호는 요청 바디와 같지 않아야함
      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      const user = users[0];
      expect(user?.email).toBe(valid.email);
      expect(user?.nickname).toBe(valid.nickname);
      expect(user?.deletedAt).toBeNull();
      expect(user?.id).toMatch(UUID);
      const hash = user?.passwordHash ?? "";
      expect(hash).not.toContain(valid.password);

      // 요청 비밀번호와 해시된 비밀번호는 같아야함
      expect(await bcrypt.compare(valid.password, hash)).toBe(true);
      expect(await bcrypt.compare("password2", hash)).toBe(false);

      // 요청 비밀번호와 해시된 비밀번호는 응답에 포함되지 않아야함
      expectNoSecret(res, valid.password, hash);
    });

    it("같은 이메일 계정이 없을 때 앞뒤 공백과 대문자가 섞인 이메일·공백 낀 닉네임으로 가입하면 201을 받고 이메일은 소문자로, 닉네임은 공백 제거되어 저장된다", async () => {
      const res = await request(app)
        .post(SIGNUP)
        .send({ email: "  Alice@Example.COM ", password: "password1", nickname: "  alice  " });

      // 저렇게 보내도 201에 빈 응답
      expect(res.status).toBe(201);
      expect(res.text).toBe("");

      // 유저의 수가 +1 되어야함
      // 이메일은 소문자 정규화하고 닉네임은 앞뒤 공백 제거해서 들어가있어야함
      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0]?.email).toBe("alice@example.com");
      expect(users[0]?.nickname).toBe("alice");
    });

    it("같은 이메일 계정이 없을 때 사이에 공백(연속 공백 포함)이 있는 닉네임으로 가입하면 201을 받고 앞뒤 공백만 제거되어 사이 공백은 그대로 저장된다", async () => {
      const res = await request(app)
        .post(SIGNUP)
        .send({ ...valid, nickname: "  ali  ce  " });

      // 201이 응답되어야함
      expect(res.status).toBe(201);

      // 사이 공백은 지우거나 한 칸으로 줄이지 않음
      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0]?.nickname).toBe("ali  ce");
    });

    it("같은 이메일 계정이 없을 때 경계값(비밀번호 8자, 닉네임 2자·20자)으로 가입하면 201을 받고 사용자가 저장된다", async () => {
      const short = await request(app)
        .post(SIGNUP)
        .send({ email: "a@example.com", password: "abcdefg1", nickname: "ab" });
      const long = await request(app)
        .post(SIGNUP)
        .send({ email: "b@example.com", password: "abcdefg1", nickname: "a".repeat(20) });

      expect(short.status).toBe(201);
      expect(long.status).toBe(201);
      expect(await prisma.user.count()).toBe(2);
    });
  });

  describe("시나리오 2: 중복", () => {
    it("같은 이메일 계정이 이미 있을 때 그 이메일로 가입하면 409를 받고 사용자 수는 늘지 않으며 응답에 비밀번호가 없다", async () => {
      const existing = await seedUser({ email: valid.email, nickname: "someone" });

      const res = await request(app).post(SIGNUP).send(valid);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("이메일");
      expect(res.body.error).not.toContain("닉네임");
      expectNoSecret(res, valid.password, existing.passwordHash);
      expect(await prisma.user.count()).toBe(1);
    });

    it("같은 이메일 계정이 이미 있을 때 대소문자만 다른 이메일로 가입하면 409를 받고 사용자 수는 늘지 않는다", async () => {
      const existing = await seedUser({ email: valid.email, nickname: "someone" });

      const res = await request(app).post(SIGNUP).send({ ...valid, email: "ALICE@Example.com" });

      expect(res.status).toBe(409);
      expectNoSecret(res, valid.password, existing.passwordHash);
      expect(await prisma.user.count()).toBe(1);
    });

    it("같은 닉네임 계정이 이미 있을 때 그 닉네임으로 가입하면 409를 받고 사용자 수는 늘지 않으며 응답에 비밀번호가 없다", async () => {
      const existing = await seedUser({ email: "other@example.com", nickname: valid.nickname });

      const res = await request(app).post(SIGNUP).send(valid);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("닉네임");
      expect(res.body.error).not.toContain("이메일");
      expectNoSecret(res, valid.password, existing.passwordHash);
      expect(await prisma.user.count()).toBe(1);
    });

    it("같은 이메일·닉네임 계정이 탈퇴(deletedAt 기록) 상태일 때 그 값으로 가입하면 409가 아닌 201을 받고 활성 사용자가 새로 저장된다", async () => {
      await seedUser({ email: valid.email, nickname: valid.nickname, deletedAt: new Date() });

      const res = await request(app).post(SIGNUP).send(valid);

      expect(res.status).toBe(201);
      expect(await prisma.user.count()).toBe(2);
      expect(await prisma.user.count({ where: { email: valid.email, deletedAt: null } })).toBe(1);
    });
  });

  describe("시나리오 3: 입력 검증", () => {
    it.each([
      ["이메일 형식이 아니면", { ...valid, email: "not-an-email" }],
      ["비밀번호가 8자 미만이면", { ...valid, password: "abcde12" }],
      ["비밀번호에 숫자가 없으면", { ...valid, password: "abcdefgh" }],
      ["비밀번호에 영문자가 없으면", { ...valid, password: "12345678" }],
      ["닉네임이 2자 미만이면", { ...valid, nickname: "a" }],
      ["닉네임이 20자 초과이면", { ...valid, nickname: "a".repeat(21) }],
      ["닉네임이 공백만 있으면", { ...valid, nickname: "   " }],
      ["필드 타입이 다르면", { ...valid, password: 12345678 }],
      ["필드가 빠졌으면", { email: valid.email, password: valid.password }],
    ])("빈 DB 상태에서 %s 가입 시 400을 받고 사용자는 저장되지 않는다", async (_label, body) => {
      const res = await request(app).post(SIGNUP).send(body);

      expect(res.status).toBe(400);
      expectNoSecret(res, String(body.password));
      expect(await prisma.user.count()).toBe(0);
    });

    it.each([
      ["JSON이 아닌 text/plain 본문이면", "text/plain", `email=${valid.email}&password=${valid.password}&nickname=${valid.nickname}`],
      ["JSON이 아닌 form 본문이면", "application/x-www-form-urlencoded", `email=${encodeURIComponent(valid.email)}&password=${valid.password}&nickname=${valid.nickname}`],
      ["문법이 깨진 application/json 본문이면", "application/json", `{"email":"${valid.email}","password":"${valid.password}","nickname":"${valid.nickname}"`],
    ])("빈 DB 상태에서 %s 가입 시 400을 받고 사용자는 저장되지 않는다", async (_label, contentType, raw) => {
      const res = await request(app).post(SIGNUP).set("Content-Type", contentType).send(raw);

      expect(res.status).toBe(400);
      expectNoSecret(res, valid.password);
      expect(await prisma.user.count()).toBe(0);
    });

    it.each([
      ["같은 이메일 활성 계정이 있을 때 비밀번호가 8자 미만이면", { ...valid, password: "abcde12" }],
      ["같은 이메일 활성 계정이 있을 때 닉네임이 2자 미만이면", { ...valid, nickname: "a" }],
      ["같은 닉네임 활성 계정이 있을 때 이메일 형식이 아니면", { ...valid, email: "not-an-email", nickname: "someone" }],
    ])("%s 가입 시 409가 아닌 400을 받고 기존 사용자는 그대로다", async (_label, body) => {
      const existing = await seedUser({ email: valid.email, nickname: "someone" });

      const res = await request(app).post(SIGNUP).send(body);

      expect(res.status).toBe(400);
      expectNoSecret(res, body.password, existing.passwordHash);
      expect(await prisma.user.findMany()).toEqual([existing]);
    });

    it("빈 DB 상태에서 비밀번호가 UTF-8 72바이트면 201을 받고, 73바이트면 글자 수가 72자 이하여도 400을 받아 저장되지 않는다", async () => {
      const fit = "a1" + "가".repeat(23) + "b";
      const over = "a1" + "가".repeat(23) + "bc";

      const ok = await request(app).post(SIGNUP).send({ ...valid, password: fit });
      const bad = await request(app).post(SIGNUP).send({ email: "bob@example.com", password: over, nickname: "bob" });

      expect(ok.status).toBe(201);
      expect(bad.status).toBe(400);
      expectNoSecret(bad, over);
      expect((await prisma.user.findMany()).map((u) => u.email)).toEqual([valid.email]);
    });

    it("빈 DB 상태에서 이메일이 정규화 후 254자면 앞뒤 공백·대문자가 붙어 있어도 201을 받고, 255자면 400을 받아 저장되지 않는다", async () => {
      const longEmail = (local: string, length: number) =>
        `${local.repeat(64)}@${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(length - 197)}.com`;
      const fit = longEmail("d", 254);
      const over = longEmail("e", 255);

      const ok = await request(app).post(SIGNUP).send({ ...valid, email: `  ${fit.toUpperCase()} ` });
      const bad = await request(app).post(SIGNUP).send({ ...valid, email: over, nickname: "bob" });

      expect(ok.status).toBe(201);
      expect(bad.status).toBe(400);
      expectNoSecret(bad, valid.password);
      expect((await prisma.user.findMany()).map((user) => user.email)).toEqual([fit]);
    });

    it("빈 DB 상태에서 닉네임이 앞뒤 공백 제거 후 1자면 400을 받고, 앞뒤 공백 제거 후 20자면 원본이 20자를 넘어도 201을 받는다", async () => {
      const bad = await request(app).post(SIGNUP).send({ ...valid, nickname: " a " });
      const ok = await request(app).post(SIGNUP).send({ ...valid, email: "bob@example.com", nickname: `  ${"a".repeat(20)}  ` });

      expect(bad.status).toBe(400);
      expect(ok.status).toBe(201);
      expectNoSecret(bad, valid.password);
      expect((await prisma.user.findMany()).map((u) => u.nickname)).toEqual(["a".repeat(20)]);
    });

    it("빈 DB 상태에서 사이 공백을 포함해 닉네임이 20자면 201을 받고 그대로 저장되며, 21자면 400을 받는다", async () => {
      const fit = "a" + " ".repeat(18) + "b";
      const over = "a" + " ".repeat(19) + "b";

      const ok = await request(app).post(SIGNUP).send({ ...valid, nickname: fit });
      const bad = await request(app).post(SIGNUP).send({ ...valid, email: "bob@example.com", nickname: over });

      expect(ok.status).toBe(201);
      expect(bad.status).toBe(400);
      expectNoSecret(bad, valid.password);
      expect((await prisma.user.findMany()).map((u) => u.nickname)).toEqual([fit]);
    });
  });

  describe("시나리오 4: 동시 가입", () => {
    it.each([
      ["같은 이메일·다른 닉네임", (i: number) => ({ ...valid, nickname: `alice${i}` })],
      ["다른 이메일·같은 닉네임", (i: number) => ({ ...valid, email: `alice${i}@example.com` })],
    ])("빈 DB 상태에서 %s 가입 요청 5개가 동시에 들어오면 하나만 201, 나머지는 409를 받고 사용자는 하나만 저장된다", async (_label, makeBody) => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => request(app).post(SIGNUP).send(makeBody(i))),
      );

      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
      expect(await prisma.user.count()).toBe(1);
    });
  });
});
