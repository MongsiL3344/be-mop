import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const ME = "/users/me";
const LOGIN = "/users/login";
const LOGOUT = "/users/logout";
// app.ts의 express-session에서 지정한 세션 쿠키 이름과 수명(7일)
const SID = "sid";
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 7;

const alice = { email: "alice@example.com", password: "password1", nickname: "alice" };

const seedUser = async (data: { email: string; password: string; nickname: string; deletedAt?: Date }) => {
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

// 로그인 응답의 Set-Cookie에서 sid 값만 꺼낸다 ("sid=s%3Aabc.xyz; Path=/" → "s%3Aabc.xyz")
const sidOf = (res: request.Response) => {
  const line = (res.get("Set-Cookie") ?? []).find((l) => l.startsWith(`${SID}=`)) ?? "";
  const sid = (line.split(";")[0] ?? "").slice(`${SID}=`.length);
  expect(sid).not.toBe("");
  return sid;
};

// 클라이언트 쿠키 저장소와 상관없이 특정 sid를 직접 실어 내 정보를 조회한다
const meWithSid = (sid: string) => request(app).get(ME).set("Cookie", `${SID}=${sid}`);

// 비로그인 401이고, 식별자 없음과 같은 메시지인지 확인한다
const expectUnauthorized = async (res: request.Response) => {
  const anonymous = await request(app).get(ME); // 식별자 없이 조회한 응답이 비로그인 401 메시지의 기준
  expect(anonymous.status).toBe(401);
  expect(typeof anonymous.body.error).toBe("string");
  expect(res.status).toBe(401);
  expect(res.body).toEqual(anonymous.body);
};

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US3 내 정보 조회와 로그인 필수 보호", () => {
  describe("시나리오 1: 로그인 상태에서 내 정보 조회", () => {
    it("로그인한 상태에서 내 정보를 조회하면 200과 로그인한 사용자의 id·email·nickname만 받고 비밀번호는 없으며 DB 사용자는 바뀌지 않는다", async () => {
      const user = await seedUser(alice);
      const agent = request.agent(app);
      expect((await login(agent, alice)).status).toBe(200);
      const res = await agent.get(ME);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(profile(user));
      expect(res.text).not.toContain(alice.password);
      expect(res.text).not.toContain(user.passwordHash);
      expect(await allUsers()).toEqual([user]);
    });
  });

  describe("시나리오 2: 로그인하지 않은 상태의 내 정보 조회", () => {
    it("식별자(세션 쿠키) 없이 내 정보를 조회하면 5xx가 아닌 401과 문자열 오류 메시지를 받고 DB 사용자는 바뀌지 않는다", async () => {
      const user = await seedUser(alice);

      const res = await request(app).get(ME);

      expect(res.status).toBe(401);
      expect(typeof res.body.error).toBe("string");
      expect(await allUsers()).toEqual([user]);
    });

    it("로그인 때 받은 식별자가 만료된 뒤 그 식별자로 내 정보를 조회하면 식별자 없음과 같은 메시지의 401을 받는다", async () => {
      const user = await seedUser(alice);
      const sid = sidOf(await login(request.agent(app), alice));
      expect((await meWithSid(sid)).status).toBe(200);

      // vitest 객체의 Date만 가짜로 바꾸고 만료 시간 이후로 시간 조작
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + SESSION_MAX_AGE + 60_000);

      // 그러면 인증되지 않아야함
      const res = await meWithSid(sid);
      await expectUnauthorized(res);

      vi.useRealTimers();
      expect(await allUsers()).toEqual([user]);
    });

    it("서명이 위조된 식별자로 내 정보를 조회하면 식별자 없음과 같은 메시지의 401을 받는다", async () => {
      const user = await seedUser(alice);
      const sid = sidOf(await login(request.agent(app), alice));
      expect((await meWithSid(sid)).status).toBe(200);

      const forged = `${sid.slice(0, sid.lastIndexOf(".") + 1)}forgedsignature`; // 의미없는 가짜 서명으로 변경

      // 인증되지 않아야함
      const res = await meWithSid(forged);
      await expectUnauthorized(res);

      expect(await allUsers()).toEqual([user]);
    });

    it("로그아웃으로 폐기된 식별자를 다시 실어 내 정보를 조회하면 식별자 없음과 같은 메시지의 401을 받는다", async () => {
      const user = await seedUser(alice);
      const agent = request.agent(app);
      const sid = sidOf(await login(agent, alice));
      expect((await meWithSid(sid)).status).toBe(200);
      expect((await agent.post(LOGOUT)).status).toBe(204);

      const res = await meWithSid(sid);
      await expectUnauthorized(res);

      expect(await allUsers()).toEqual([user]);
    });
  });

  describe("시나리오 3: 로그인 중 탈퇴 처리된 사용자", () => {
    it("로그인 상태였으나 그 사이 사용자에게 삭제 시각이 기록된 뒤 내 정보를 조회하면 비로그인과 같은 메시지의 401을 받는다", async () => {
      const user = await seedUser(alice);
      const agent = request.agent(app);
      expect((await login(agent, alice)).status).toBe(200);
      expect((await agent.get(ME)).status).toBe(200);

      const deletedAt = new Date();
      await prisma.user.update({ where: { id: user.id }, data: { deletedAt } });

      const res = await agent.get(ME);
      await expectUnauthorized(res);
      expect(await allUsers()).toEqual([{ ...user, deletedAt }]);
    });
  });

  describe("시나리오 4: 로그아웃 후 내 정보 조회", () => {
    it("로그인 상태에서 로그아웃한 뒤 같은 클라이언트로 내 정보를 조회하면 비로그인과 같은 메시지의 401을 받고 DB 사용자는 바뀌지 않는다", async () => {
      const user = await seedUser(alice);
      const agent = request.agent(app);
      expect((await login(agent, alice)).status).toBe(200);
      expect((await agent.get(ME)).status).toBe(200);

      expect((await agent.post(LOGOUT)).status).toBe(204);
      const res = await agent.get(ME);
      await expectUnauthorized(res);

      expect(await allUsers()).toEqual([user]);
    });
  });
});
