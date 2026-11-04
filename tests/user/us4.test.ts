import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, CLIENT_ORIGIN } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const SIGNUP = "/users/signup";
const LOGIN = "/users/login";
const LOGOUT = "/users/logout";
const ME = "/users/me";
// app.ts의 express-session에서 지정한 세션 쿠키 이름
const SID = "sid";

const TRUSTED = CLIENT_ORIGIN;
const OTHER = "https://evil.example";

const alice = { email: "alice@example.com", password: "password1", nickname: "alice" };
const bob = { email: "bob@example.com", password: "password1", nickname: "bob" };

const seedUser = async (data: { email: string; password: string; nickname: string }) => {
  const { password, ...rest } = data;
  return prisma.user.create({ data: { ...rest, passwordHash: await bcrypt.hash(password, 4) } });
};

const allUsers = () => prisma.user.findMany({ orderBy: { createdAt: "asc" } });

const profile = (user: { id: string; email: string; nickname: string }) => ({
  id: user.id,
  email: user.email,
  nickname: user.nickname,
});

const login = (agent: { post(url: string): request.Test }, user: { email: string; password: string }) =>
  agent.post(LOGIN).send({ email: user.email, password: user.password });

// 응답의 Set-Cookie 중 sid 쿠키를 건드리는 줄만 모은다
const sidCookieLines = (res: request.Response) =>
  (res.get("Set-Cookie") ?? []).filter((l) => l.startsWith(`${SID}=`));

const expectForbidden = (res: request.Response) => {
  expect(res.status).toBe(403);
  expect(typeof res.body.error).toBe("string");
};

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US4 상태 변경 요청의 출처 검사", () => {
  describe("시나리오 1: 신뢰 출처의 로그아웃", () => {
    it("로그인한 상태에서 신뢰 출처의 Origin을 붙여 로그아웃하면 204가 오고 이후 내 정보 조회는 401이며 DB 사용자는 바뀌지 않는다", async () => {
      const user = await seedUser(alice);
      const agent = request.agent(app);
      expect((await login(agent, alice)).status).toBe(200);

      const res = await agent.post(LOGOUT).set("Origin", TRUSTED);

      expect(res.status).toBe(204);
      expect((await agent.get(ME)).status).toBe(401);
      expect(await allUsers()).toEqual([user]);
    });
  });

  describe("시나리오 2: 다른 출처의 로그아웃", () => {
    it("로그인한 상태에서 다른 출처의 Origin을 붙여 로그아웃하면 403이 오고 sid 쿠키를 지우는 Set-Cookie가 없으며 그 클라이언트는 여전히 로그인 상태다", async () => {
      const user = await seedUser(alice);
      const agent = request.agent(app);
      expect((await login(agent, alice)).status).toBe(200);

      const res = await agent.post(LOGOUT).set("Origin", OTHER);

      expectForbidden(res);
      expect(sidCookieLines(res)).toEqual([]);
      const me = await agent.get(ME);
      expect(me.status).toBe(200);
      expect(me.body).toEqual(profile(user));
      expect(await allUsers()).toEqual([user]);
    });

    it("로그인한 상태에서 신뢰 출처에 끝 슬래시만 붙인 Origin으로 로그아웃하면 다른 출처로 보아 403이 오고 여전히 로그인 상태다", async () => {
      const user = await seedUser(alice);
      const agent = request.agent(app);
      expect((await login(agent, alice)).status).toBe(200);

      const res = await agent.post(LOGOUT).set("Origin", `${TRUSTED}/`);

      expectForbidden(res);
      expect(sidCookieLines(res)).toEqual([]);
      expect((await agent.get(ME)).status).toBe(200);
      expect(await allUsers()).toEqual([user]);
    });
  });

  describe("시나리오 3: 다른 출처의 조회(GET)", () => {
    it("로그인한 상태에서 다른 출처의 Origin을 붙여 내 정보를 조회하면 검사 대상이 아니므로 200과 내 정보를 받는다", async () => {
      const user = await seedUser(alice);
      const agent = request.agent(app);
      expect((await login(agent, alice)).status).toBe(200);

      const res = await agent.get(ME).set("Origin", OTHER);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(profile(user));
      expect(await allUsers()).toEqual([user]);
    });
  });

  describe("시나리오 4: 다른 출처의 가입", () => {
    it("같은 이메일의 계정이 없을 때 다른 출처의 Origin을 붙여 유효한 값으로 가입하면 403이 오고 사용자는 저장되지 않는다", async () => {
      const res = await request(app).post(SIGNUP).set("Origin", OTHER).send(bob);

      expectForbidden(res);
      expect(await allUsers()).toEqual([]);
    });

    it("다른 출처의 Origin을 붙여 문법이 깨진 JSON 본문으로 가입하면 본문 파싱·검증보다 출처 검사가 먼저라 400이 아닌 403이 오고 사용자는 저장되지 않는다", async () => {
      const res = await request(app)
        .post(SIGNUP)
        .set("Origin", OTHER)
        .set("Content-Type", "application/json")
        .send('{"email": "bob@example.com",');

      expectForbidden(res);
      expect(await allUsers()).toEqual([]);
    });
  });
});
