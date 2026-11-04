import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LOGIN = "/users/login";
const LOGOUT = "/users/logout";
// app.ts의 express-session에서 지정한 세션 쿠키 이름
const SID = "sid";

const alice = { email: "alice@example.com", password: "password1", nickname: "alice" };
const bob = { email: "bob@example.com", password: "password2", nickname: "bob" };

const seedUser = async (data: { email: string; password: string; nickname: string; deletedAt?: Date }) => {
  const { password, ...rest } = data;
  return prisma.user.create({ data: { ...rest, passwordHash: await bcrypt.hash(password, 4) } });
};

const allUsers = () => prisma.user.findMany({ orderBy: { createdAt: "asc" } });

// 응답 Set-Cookie 헤더 중 sid 쿠키 한 줄 (예: "sid=s%3Aabc.xyz; Path=/; HttpOnly"), 없으면 undefined
const findSidSetCookie = (res: request.Response) => {
  const setCookies = res.get("Set-Cookie") ?? [];
  return setCookies.find((line) => line.startsWith(`${SID}=`));
};

// sid 쿠키 한 줄에서 값만 꺼낸다 ("sid=s%3Aabc.xyz; Path=/" → "s%3Aabc.xyz")
const sidValue = (setCookie: string) => {
  const nameAndValue = setCookie.split(";")[0] ?? ""; // "sid=s%3Aabc.xyz"
  return nameAndValue.slice(`${SID}=`.length);
};

// res.clearCookie("sid")가 보내는 폐기 쿠키인지: 값을 비우고 만료 시각을 1970-01-01로 보낸다
const isClearedCookie = (setCookie: string) =>
  sidValue(setCookie) === "" && setCookie.includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT");

// 새 세션 쿠키를 발급했는지 확인하고, 발급된 sid 값을 돌려준다
const expectNewSessionCookie = (res: request.Response) => {
  const setCookie = findSidSetCookie(res) ?? "";
  expect(isClearedCookie(setCookie)).toBe(false); // 지우는 쿠키가 아니어야 함 (쿠키 만료는 sid에 빈 값 할당으로 구현)
  const sid = sidValue(setCookie);
  expect(sid).not.toBe(""); // Sid 값이 빈 값이 아니어야함
  return sid;
};

// 새 세션 쿠키를 발급하지 않았는지 확인한다 (sid 쿠키가 없거나, 있으면 지우는 쿠키)
const expectNoNewSessionCookie = (res: request.Response) => {
  const setCookie = findSidSetCookie(res);
  if (setCookie !== undefined) expect(isClearedCookie(setCookie)).toBe(true);
};

// sid 쿠키를 지우라고 보냈는지 확인한다 (로그아웃)
const expectClearedSessionCookie = (res: request.Response) => {
  const setCookie = findSidSetCookie(res) ?? "";
  expect(isClearedCookie(setCookie)).toBe(true);
};

// 응답 본문·헤더 어디에도 비밀값(비밀번호, 해시)이 들어 있지 않은지 확인한다
const expectNoSecret = (res: request.Response, ...secrets: string[]) => {
  const wholeResponse = res.text + JSON.stringify(res.headers);
  for (const secret of secrets) expect(wholeResponse).not.toContain(secret);
};

// 테스트 전용 라우트: 이 요청의 서버 세션에 무엇이 저장돼 있는지 돌려준다
// express-session이 기본으로 넣는 cookie 설정을 빼고 남은 값이 있으면 로그인 상태(active)로 본다
const PROBE = "/__us2/session";
app.get(PROBE, (req, res) => {
  const { cookie: _cookieOptions, ...data } = req.session;
  res.json({ active: Object.keys(data).length > 0, data });
});

// 예전에 받은 sid를 직접 실어 보내, 브라우저 쿠키와 상관없이 서버에 그 세션이 남아 있는지 확인한다
const probe = (sid: string) => request(app).get(PROBE).set("Cookie", `${SID}=${sid}`);

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US2 로그인 / 로그아웃", () => {
  describe("시나리오 1: 로그인 성공", () => {
    it("가입된 사용자가 올바른 이메일·비밀번호로 로그인하면 200과 비밀번호 없는 사용자 정보(id, email, nickname)를 받고 새 세션 식별자가 발급되며 DB 사용자는 바뀌지 않는다", async () => {
      const user = await seedUser(alice);

      const res = await request(app).post(LOGIN).send({ email: alice.email, password: alice.password });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: user.id, email: user.email, nickname: user.nickname });
      expectNewSessionCookie(res);
      expectNoSecret(res, alice.password, user.passwordHash);
      expect(await allUsers()).toEqual([user]);
    });

    it("가입된 사용자가 앞뒤 공백·대문자가 섞인 이메일로 로그인하면 정규화되어 200을 받고 새 세션 식별자가 발급되며 저장된 이메일은 소문자 그대로다", async () => {
      const user = await seedUser(alice);

      const res = await request(app).post(LOGIN).send({ email: "  Alice@Example.COM ", password: alice.password });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: user.id, email: "alice@example.com", nickname: user.nickname });
      expectNewSessionCookie(res);
      expect(await allUsers()).toEqual([user]);
    });

    it("가입된 사용자가 이미 로그인한 클라이언트에서 다시 로그인하면 200을 받고 이전과 다른 세션 식별자가 새로 발급되며 이전 세션은 서버에서 폐기된다", async () => {
      const user = await seedUser(alice);
      const agent = request.agent(app);

      const first = await agent.post(LOGIN).send({ email: alice.email, password: alice.password });
      const second = await agent.post(LOGIN).send({ email: alice.email, password: alice.password });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ id: user.id, email: user.email, nickname: user.nickname });
      const firstSid = expectNewSessionCookie(first);
      expect(expectNewSessionCookie(second)).not.toBe(firstSid);
      expect((await probe(firstSid)).body.active).toBe(false); // 이전 세션은 서버 저장소에서 삭제돼 있어야 한다
      expect(await allUsers()).toEqual([user]);
    });

    it("가입된 두 사용자 중 한 명으로 로그인한 클라이언트에서 다른 사용자로 로그인하면 200과 새 사용자 정보를 받고 새 세션 식별자로 교체되며 이전 세션은 서버에서 폐기된다", async () => {
      const a = await seedUser(alice);
      const b = await seedUser(bob);
      const agent = request.agent(app);

      const first = await agent.post(LOGIN).send({ email: alice.email, password: alice.password });
      const second = await agent.post(LOGIN).send({ email: bob.email, password: bob.password });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ id: b.id, email: b.email, nickname: b.nickname });
      const firstSid = expectNewSessionCookie(first);
      expect(expectNewSessionCookie(second)).not.toBe(firstSid);
      expect((await probe(firstSid)).body.active).toBe(false); // 이전 세션은 서버 저장소에서 삭제돼 있어야 한다
      expect(await allUsers()).toEqual([a, b]);
    });

    it("같은 이메일의 탈퇴 계정과 활성 계정이 있을 때 활성 계정 비밀번호로 로그인하면 200과 활성 계정 정보를 받는다", async () => {
      const deleted = await seedUser({ ...alice, password: "oldpass1", nickname: "old-alice", deletedAt: new Date() });
      const active = await seedUser(alice);

      const res = await request(app).post(LOGIN).send({ email: alice.email, password: alice.password });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: active.id, email: active.email, nickname: active.nickname });
      expectNewSessionCookie(res);
      expect(await allUsers()).toEqual([deleted, active]);
    });
  });

  describe("시나리오 2: 자격 증명 실패", () => {
    it.each([
      ["비밀번호가 틀리면", { email: alice.email, password: "wrongpass1" }],
      ["비밀번호가 8자 미만이면", { email: alice.email, password: "abc1" }],
      ["비밀번호에 숫자가 없으면", { email: alice.email, password: "abcdefgh" }],
      ["비밀번호에 영문자가 없으면", { email: alice.email, password: "12345678" }],
      ["없는 이메일이면", { email: "nobody@example.com", password: alice.password }],
      ["탈퇴한 계정이면", { email: bob.email, password: bob.password }],
    ])("가입된 사용자가 있을 때 %s 로그인 시 401과 없는 이메일 실패와 같은 단일 메시지를 받고 세션 식별자는 발급되지 않으며 DB 사용자는 바뀌지 않는다", async (_label, body) => {
      const a = await seedUser(alice);
      const b = await seedUser({ ...bob, deletedAt: new Date() });

      const res = await request(app).post(LOGIN).send(body);
      const noEmail = await request(app).post(LOGIN).send({ email: "nobody@example.com", password: alice.password });

      expect(res.status).toBe(401);
      expect(typeof res.body.error).toBe("string");
      expect(noEmail.status).toBe(401);
      expect(res.body).toEqual(noEmail.body);
      expectNoNewSessionCookie(res);
      expectNoSecret(res, body.password, a.passwordHash, b.passwordHash);
      expect(await allUsers()).toEqual([a, b]);
    });

    it("가입된 사용자가 있을 때 없는 이메일·틀린 비밀번호·탈퇴 계정으로 로그인하면 모두 401과 같은 응답 본문을 받아 계정 존재 여부를 구분할 수 없다", async () => {
      const a = await seedUser(alice);
      const b = await seedUser({ ...bob, deletedAt: new Date() });

      const noEmail = await request(app).post(LOGIN).send({ email: "nobody@example.com", password: alice.password });
      const wrongPw = await request(app).post(LOGIN).send({ email: alice.email, password: "wrongpass1" });
      const deleted = await request(app).post(LOGIN).send({ email: bob.email, password: bob.password });

      expect([noEmail.status, wrongPw.status, deleted.status]).toEqual([401, 401, 401]);
      expect(wrongPw.body).toEqual(noEmail.body);
      expect(deleted.body).toEqual(noEmail.body);
      expect(await allUsers()).toEqual([a, b]);
    });

    it("로그인한 클라이언트에서 틀린 비밀번호로 다시 로그인하면 401을 받고 기존 세션 식별자는 교체·폐기되지 않으며 서버 세션의 로그인 정보도 그대로 유지된다", async () => {
      const user = await seedUser(alice);
      const agent = request.agent(app);

      const ok = await agent.post(LOGIN).send({ email: alice.email, password: alice.password });
      expect(ok.status).toBe(200);
      const sid = expectNewSessionCookie(ok);
      const before = (await probe(sid)).body;
      expect(before.active).toBe(true);

      const res = await agent.post(LOGIN).send({ email: alice.email, password: "wrongpass1" });

      expect(res.status).toBe(401);
      expect(findSidSetCookie(res)).toBeUndefined();
      expect((await probe(sid)).body).toEqual(before);
      expect((await agent.get(PROBE)).body).toEqual(before);
      expect(await allUsers()).toEqual([user]);
    });
  });

  describe("시나리오 3: 로그아웃", () => {
    it("로그인 상태에서 로그아웃하면 204 빈 본문을 받고 세션 쿠키가 폐기되며 로그인 때 받은 식별자를 재전송해도 서버 세션은 비로그인이고 DB 사용자는 바뀌지 않는다", async () => {
      const user = await seedUser(alice);
      const agent = request.agent(app);
      const login = await agent.post(LOGIN).send({ email: alice.email, password: alice.password });
      const sid = expectNewSessionCookie(login);
      expect((await probe(sid)).body.active).toBe(true);

      const res = await agent.post(LOGOUT);

      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expectClearedSessionCookie(res);
      expect((await probe(sid)).body).toEqual({ active: false, data: {} });
      expect(await allUsers()).toEqual([user]);
    });

    it("같은 사용자가 두 클라이언트에서 각각 로그인하면 서로 다른 세션 식별자가 발급되고, 한 클라이언트가 로그아웃하면 204와 그 클라이언트의 서버 세션만 폐기되며 다른 클라이언트의 로그인 상태는 유지된다", async () => {
      const user = await seedUser(alice);
      const pc = request.agent(app);
      const phone = request.agent(app);
      const pcLogin = await pc.post(LOGIN).send({ email: alice.email, password: alice.password });
      const phoneLogin = await phone.post(LOGIN).send({ email: alice.email, password: alice.password });
      expect(pcLogin.status).toBe(200);
      expect(phoneLogin.status).toBe(200);
      const pcSid = expectNewSessionCookie(pcLogin);
      const phoneSid = expectNewSessionCookie(phoneLogin);
      expect(phoneSid).not.toBe(pcSid);
      expect((await probe(pcSid)).body.active).toBe(true);
      const phoneBefore = (await probe(phoneSid)).body;
      expect(phoneBefore.active).toBe(true);

      const res = await pc.post(LOGOUT);

      expect(res.status).toBe(204);
      expectClearedSessionCookie(res);
      expect((await pc.get(PROBE)).body).toEqual({ active: false, data: {} });
      expect((await probe(pcSid)).body).toEqual({ active: false, data: {} });
      expect((await probe(phoneSid)).body).toEqual(phoneBefore);
      expect((await phone.get(PROBE)).body).toEqual(phoneBefore);
      expect(await allUsers()).toEqual([user]);
    });

    it("로그인하지 않은 상태에서 로그아웃하면 204를 받고(멱등) 세션 식별자는 발급되지 않으며 DB 사용자는 바뀌지 않는다", async () => {
      const user = await seedUser(alice);

      const res = await request(app).post(LOGOUT);

      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expectNoNewSessionCookie(res);
      expect(await allUsers()).toEqual([user]);
    });
  });

  describe("시나리오 4: 형식 오류", () => {
    it.each([
      ["이메일 형식이 아니면", { email: "not-an-email", password: alice.password }],
      ["이메일이 빠졌으면", { password: alice.password }],
      ["비밀번호가 빠졌으면", { email: alice.email }],
      ["이메일 타입이 다르면", { email: 12345, password: alice.password }],
      ["비밀번호 타입이 다르면", { email: alice.email, password: 12345678 }],
      ["비밀번호가 빈 문자열이면", { email: alice.email, password: "" }],
      ["비밀번호가 UTF-8 72바이트를 넘으면", { email: alice.email, password: "a1" + "가".repeat(23) + "bc" }],
    ])("가입된 사용자가 있을 때 %s 로그인 시 401이 아닌 400을 받고 세션 식별자는 발급되지 않으며 DB 사용자는 바뀌지 않는다", async (_label, body) => {
      const user = await seedUser(alice);

      const res = await request(app).post(LOGIN).send(body);

      expect(res.status).toBe(400);
      expectNoNewSessionCookie(res);
      expectNoSecret(res, user.passwordHash);
      expect(await allUsers()).toEqual([user]);
    });

    it.each([
      ["JSON이 아닌 text/plain 본문이면", "text/plain", `email=${alice.email}&password=${alice.password}`],
      ["JSON이 아닌 form 본문이면", "application/x-www-form-urlencoded", `email=${encodeURIComponent(alice.email)}&password=${alice.password}`],
      ["문법이 깨진 application/json 본문이면", "application/json", `{"email":"${alice.email}","password":"${alice.password}"`],
      ["비밀번호가 빈 문자열인 JSON이면", "application/json", JSON.stringify({ email: alice.email, password: "" })],
    ])("로그인한 클라이언트에서 %s 다시 로그인 시 400을 받고 기존 세션 식별자는 교체·폐기되지 않으며 서버 세션의 로그인 정보도 그대로 유지된다", async (_label, contentType, raw) => {
      const user = await seedUser(alice);
      const agent = request.agent(app);
      const ok = await agent.post(LOGIN).send({ email: alice.email, password: alice.password });
      expect(ok.status).toBe(200);
      const sid = expectNewSessionCookie(ok);
      const before = (await probe(sid)).body;
      expect(before.active).toBe(true);

      const res = await agent.post(LOGIN).set("Content-Type", contentType).send(raw);

      expect(res.status).toBe(400);
      expect(findSidSetCookie(res)).toBeUndefined();
      expect((await probe(sid)).body).toEqual(before);
      expect((await agent.get(PROBE)).body).toEqual(before);
      expectNoSecret(res, user.passwordHash);
      expect(await allUsers()).toEqual([user]);
    });

    it("가입된 사용자가 정의되지 않은 추가 필드를 붙여 올바른 이메일·비밀번호로 로그인하면 추가 필드는 무시되고 200과 실제 사용자 정보를 받으며 DB 사용자는 바뀌지 않는다", async () => {
      const user = await seedUser(alice);

      const res = await request(app)
        .post(LOGIN)
        .send({ email: alice.email, password: alice.password, nickname: "hacker", id: "x", role: "admin" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: user.id, email: user.email, nickname: user.nickname });
      expectNewSessionCookie(res);
      expect(await allUsers()).toEqual([user]);
    });

    it("UTF-8 72바이트 비밀번호로 가입된 사용자가 그 비밀번호로 로그인하면 200을, 1바이트 더 붙여 73바이트로 로그인하면 401이 아닌 400을 받는다", async () => {
      const fit = "a1" + "가".repeat(23) + "b";
      const user = await seedUser({ ...alice, password: fit });

      const ok = await request(app).post(LOGIN).send({ email: alice.email, password: fit });
      const bad = await request(app).post(LOGIN).send({ email: alice.email, password: fit + "c" });

      expect(ok.status).toBe(200);
      expectNewSessionCookie(ok);
      expect(bad.status).toBe(400);
      expectNoNewSessionCookie(bad);
      expect(await allUsers()).toEqual([user]);
    });

    it("정규화 후 254자 이메일로 가입된 사용자가 앞뒤 공백·대문자를 섞은 같은 이메일로 로그인하면 200을, 다른 형식 조건은 만족하지만 정규화 후 255자인 이메일로 로그인하면 401이 아닌 400을 받고 세션 식별자는 발급되지 않는다", async () => {
      // 로컬 64자, 도메인 라벨 63자 이하로 길이 외 형식 조건은 모두 만족한다
      const email = (dLen: number) => `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(dLen)}.com`;
      const fit = email(57);
      const over = email(58);
      expect([fit.length, over.length]).toEqual([254, 255]);
      const user = await seedUser({ ...alice, email: fit });

      const ok = await request(app).post(LOGIN).send({ email: `  ${fit.toUpperCase()} `, password: alice.password });
      const bad = await request(app).post(LOGIN).send({ email: over, password: alice.password });
      const badPadded = await request(app).post(LOGIN).send({ email: `  ${over.toUpperCase()} `, password: alice.password });

      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ id: user.id, email: fit, nickname: user.nickname });
      expectNewSessionCookie(ok);
      expect(bad.status).toBe(400);
      expectNoNewSessionCookie(bad);
      expect(badPadded.status).toBe(400);
      expectNoNewSessionCookie(badPadded);
      expect(await allUsers()).toEqual([user]);
    });
  });
});
