import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, CLIENT_ORIGIN } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LOGIN = "/users/login";
// 태그 기능 라우터는 /tags 한 줄로 마운트되고, 종류별 하위 경로를 둔다
const TECH_STACKS = "/tags/tech-stacks";
const POSITIONS = "/tags/positions";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// app.ts의 신뢰 출처와, 그와 다른 출처
const TRUSTED = CLIENT_ORIGIN;
const OTHER = "https://evil.example";

// 보충 평면 문자(이모지): 문자 1개가 UTF-16 코드 단위 2개라 문자 수와 코드 단위 수가 다르다
const EMOJI = "😀";

const PASSWORD = "password1";

type Role = "USER" | "ADMIN";

// 사용자를 만든 뒤 역할을 저장소에서 직접 지정한다(관리자 지정은 운영자가 저장소에서 바꾸는 방식)
const seedUser = async (role: Role, nickname = role === "ADMIN" ? "admin" : "user") =>
  prisma.user.create({
    data: {
      email: `${nickname}@example.com`,
      nickname,
      role,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
    },
  });

// 해당 역할의 사용자로 로그인한 agent(세션 쿠키 유지)를 돌려준다
const loginAs = async (role: Role) => {
  const user = await seedUser(role);
  const agent = request.agent(app);
  const res = await agent.post(LOGIN).send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
};

const techStackCount = () => prisma.techStack.count();
const positionCount = () => prisma.position.count();

// 두 종류(기술 스택·포지션)를 같은 규칙으로 검증하기 위한 표
const kinds = [
  { label: "기술 스택", path: TECH_STACKS, count: techStackCount },
  { label: "포지션", path: POSITIONS, count: positionCount },
] as const;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "TechStack", "Position", "User" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US1 관리자가 기술 스택·포지션을 추가한다", () => {
  describe("시나리오 1: 기술 스택 추가 성공", () => {
    it('관리자로 로그인했고 같은 이름의 기술 스택이 없을 때 "React"로 추가하면 201과 새 태그의 id(UUID)·name을 받고 기술 스택이 1개 저장된다', async () => {
      const { agent } = await loginAs("ADMIN");

      const res = await agent.post(TECH_STACKS).send({ name: "React" });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.stringMatching(UUID), name: "React" });
      expect(await prisma.techStack.findMany()).toEqual([{ id: res.body.id, name: "React" }]);
      expect(await positionCount()).toBe(0);
    });

    it('관리자로 로그인했고 같은 이름의 기술 스택이 없을 때 앞뒤 공백이 붙은 "  React "로 추가하면 201을 받고 공백이 제거된 "React"로 저장된다', async () => {
      const { agent } = await loginAs("ADMIN");

      const res = await agent.post(TECH_STACKS).send({ name: "  React " });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.stringMatching(UUID), name: "React" });
      expect(await prisma.techStack.findMany()).toEqual([{ id: res.body.id, name: "React" }]);
    });

    it.each([
      ["특수문자 C++", "C++"],
      ["특수문자 C#", "C#"],
      ["점이 있는 Node.js", "Node.js"],
      ["사이 공백(연속 공백 포함)", "Spring  Boot 3"],
      ["한글 30자", "가".repeat(30)],
      ["영문 30자", "a".repeat(30)],
      ["이모지(보충 평면 문자) 30자", EMOJI.repeat(30)],
      ["이모지·한글·특수문자가 섞인 30자", `🚀${"가".repeat(27)}#🔥`],
    ])("관리자로 로그인했고 같은 이름의 기술 스택이 없을 때 이름이 %s이면 201을 받고 입력한 표기 그대로 저장된다", async (_label, name) => {
      const { agent } = await loginAs("ADMIN");

      const res = await agent.post(TECH_STACKS).send({ name });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.stringMatching(UUID), name });
      expect(await prisma.techStack.findMany()).toEqual([{ id: res.body.id, name }]);
    });

    it("관리자로 로그인했고 같은 이름의 기술 스택이 없을 때 정의되지 않은 추가 필드(id 포함)를 덧붙여 추가하면 추가 필드는 무시되고 201과 함께 새 UUID로 저장된다", async () => {
      const { agent } = await loginAs("ADMIN");
      const forgedId = "00000000-0000-4000-8000-000000000000";

      const res = await agent.post(TECH_STACKS).send({ name: "React", id: forgedId, color: "blue" });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.stringMatching(UUID), name: "React" });
      expect(res.body.id).not.toBe(forgedId);
      expect(await prisma.techStack.findMany()).toEqual([{ id: res.body.id, name: "React" }]);
    });

    it("일반 사용자로 로그인한 뒤 저장소에서 역할이 관리자로 바뀌면 다시 로그인하지 않아도 기술 스택 추가가 201로 허용되고 저장된다", async () => {
      const { agent, user } = await loginAs("USER");
      await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });

      const res = await agent.post(TECH_STACKS).send({ name: "React" });

      expect(res.status).toBe(201);
      expect(await prisma.techStack.findMany()).toEqual([{ id: res.body.id, name: "React" }]);
    });
  });

  describe("시나리오 2: 포지션 추가 성공", () => {
    it('관리자로 로그인했고 같은 이름의 포지션이 없을 때 "백엔드"로 추가하면 201과 새 태그의 id(UUID)·name을 받고 포지션이 1개 저장된다', async () => {
      const { agent } = await loginAs("ADMIN");

      const res = await agent.post(POSITIONS).send({ name: "백엔드" });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.stringMatching(UUID), name: "백엔드" });
      expect(await prisma.position.findMany()).toEqual([{ id: res.body.id, name: "백엔드" }]);
      expect(await techStackCount()).toBe(0);
    });

    it('관리자로 로그인했고 같은 이름의 포지션이 없을 때 앞뒤 공백이 붙은 " 백엔드  "로 추가하면 201을 받고 "백엔드"로 저장된다', async () => {
      const { agent } = await loginAs("ADMIN");

      const res = await agent.post(POSITIONS).send({ name: " 백엔드  " });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.stringMatching(UUID), name: "백엔드" });
      expect(await prisma.position.findMany()).toEqual([{ id: res.body.id, name: "백엔드" }]);
    });

    it('관리자로 로그인했고 기술 스택에만 "DevOps"가 있고 같은 이름의 포지션이 없을 때 포지션 "DevOps"를 추가하면 201을 받고 두 목록에 각각 1개씩 저장된다', async () => {
      const existing = await prisma.techStack.create({ data: { name: "DevOps" } });
      const { agent } = await loginAs("ADMIN");

      const res = await agent.post(POSITIONS).send({ name: "DevOps" });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.stringMatching(UUID), name: "DevOps" });
      expect(await prisma.position.findMany()).toEqual([{ id: res.body.id, name: "DevOps" }]);
      expect(await prisma.techStack.findMany()).toEqual([existing]);
    });
  });

  describe("시나리오 3: 이름 중복", () => {
    it.each([
      ["같은 표기 React", "React"],
      ["소문자 react", "react"],
      ["대문자 REACT", "REACT"],
      ["앞뒤 공백이 붙은 '  react '", "  react "],
    ])('관리자로 로그인했고 "React" 기술 스택이 이미 있을 때 %s로 다시 추가하면 409를 받고 기술 스택 수는 늘지 않으며 기존 행은 바뀌지 않는다', async (_label, name) => {
      const existing = await prisma.techStack.create({ data: { name: "React" } });
      const { agent } = await loginAs("ADMIN");

      const res = await agent.post(TECH_STACKS).send({ name });

      expect(res.status).toBe(409);
      expect(await prisma.techStack.findMany()).toEqual([existing]);
    });

    it('관리자로 로그인했고 "백엔드" 포지션이 이미 있을 때 "백엔드"로 다시 추가하면 409를 받고 포지션 수는 늘지 않는다', async () => {
      const existing = await prisma.position.create({ data: { name: "백엔드" } });
      const { agent } = await loginAs("ADMIN");

      const res = await agent.post(POSITIONS).send({ name: "백엔드" });

      expect(res.status).toBe(409);
      expect(await prisma.position.findMany()).toEqual([existing]);
    });

    it('관리자로 로그인했고 "Backend" 포지션이 이미 있을 때 대소문자만 다른 "BACKEND"로 추가하면 409를 받고 포지션 수는 늘지 않는다', async () => {
      const existing = await prisma.position.create({ data: { name: "Backend" } });
      const { agent } = await loginAs("ADMIN");

      const res = await agent.post(POSITIONS).send({ name: "BACKEND" });

      expect(res.status).toBe(409);
      expect(await prisma.position.findMany()).toEqual([existing]);
    });
  });

  describe("시나리오 4: 이름 검증", () => {
    const invalidBodies: [string, unknown][] = [
      ["이름 필드가 없음", {}],
      ["이름이 null", { name: null }],
      ["이름이 숫자", { name: 123 }],
      ["이름이 불리언", { name: true }],
      ["이름이 배열", { name: ["React"] }],
      ["이름이 객체", { name: { value: "React" } }],
      ["이름이 빈 문자열", { name: "" }],
      ["이름이 공백뿐", { name: "   " }],
      ["이름이 영문 31자", { name: "a".repeat(31) }],
      ["이름이 한글 31자", { name: "가".repeat(31) }],
      ["이름이 이모지(보충 평면 문자) 31자", { name: EMOJI.repeat(31) }],
      ["공백 제거 후 31자", { name: ` ${"a".repeat(31)} ` }],
      ["이름 사이에 줄바꿈", { name: "Re\nact" }],
      ["이름 사이에 탭", { name: "Re\tact" }],
      ["이름 사이에 캐리지 리턴", { name: "Re\ract" }],
      ["이름에 NUL 제어문자", { name: "Re\u0000act" }],
      ["앞뒤 공백 제거 후에도 남는 줄바꿈", { name: " Re\nact " }],
    ];

    for (const kind of kinds) {
      it.each(invalidBodies)(
        `관리자로 로그인한 상태에서 ${kind.label}을 추가할 때 %s이면 400을 받고 아무것도 저장되지 않는다`,
        async (_label, body) => {
          const { agent } = await loginAs("ADMIN");

          const res = await agent.post(kind.path).send(body as object);

          expect(res.status).toBe(400);
          expect(await techStackCount()).toBe(0);
          expect(await positionCount()).toBe(0);
        },
      );

      it(`관리자로 로그인한 상태에서 ${kind.label}을 JSON이 아닌 본문(text/plain)으로 추가하면 400을 받고 아무것도 저장되지 않는다`, async () => {
        const { agent } = await loginAs("ADMIN");

        const res = await agent.post(kind.path).set("Content-Type", "text/plain").send("React");

        expect(res.status).toBe(400);
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);
      });
    }
  });

  describe("시나리오 5: 일반 사용자 거부", () => {
    for (const kind of kinds) {
      it(`일반 사용자(USER)로 로그인한 상태에서 유효한 이름으로 ${kind.label}을 추가하면 403을 받고 아무것도 저장되지 않는다`, async () => {
        const { agent } = await loginAs("USER");

        const res = await agent.post(kind.path).send({ name: "React" });

        expect(res.status).toBe(403);
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);
      });

      it(`일반 사용자(USER)로 로그인한 상태에서 형식이 틀린 본문으로 ${kind.label}을 추가하면 입력 검증보다 권한 검사가 먼저라 400이 아닌 403을 받고 아무것도 저장되지 않는다`, async () => {
        const { agent } = await loginAs("USER");

        const res = await agent.post(kind.path).send({ name: 123 });

        expect(res.status).toBe(403);
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);
      });

      it(`관리자로 로그인한 뒤 저장소에서 역할이 일반 사용자로 내려가면 다음 ${kind.label} 추가 요청은 403을 받고 아무것도 저장되지 않는다`, async () => {
        const { agent, user } = await loginAs("ADMIN");
        await prisma.user.update({ where: { id: user.id }, data: { role: "USER" } });

        const res = await agent.post(kind.path).send({ name: "React" });

        expect(res.status).toBe(403);
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);
      });
    }
  });

  describe("시나리오 6: 비로그인 거부", () => {
    for (const kind of kinds) {
      it(`로그인하지 않은 상태에서 유효한 이름으로 ${kind.label}을 추가하면 401을 받고 아무것도 저장되지 않는다`, async () => {
        const res = await request(app).post(kind.path).send({ name: "React" });

        expect(res.status).toBe(401);
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);
      });

      it(`로그인하지 않은 상태에서 형식이 틀린 본문으로 ${kind.label}을 추가하면 입력 검증보다 로그인 확인이 먼저라 401을 받고 아무것도 저장되지 않는다`, async () => {
        const res = await request(app).post(kind.path).send({ name: "" });

        expect(res.status).toBe(401);
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);
      });

      it(`탈퇴 처리된 관리자 계정의 로그인 상태로 유효한 이름의 ${kind.label}을 추가하면 비로그인과 같은 401을 받고 아무것도 저장되지 않는다`, async () => {
        const { agent, user } = await loginAs("ADMIN");
        await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

        const res = await agent.post(kind.path).send({ name: "React" });

        expect(res.status).toBe(401);
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);
      });
    }
  });

  describe("시나리오 5·6 보충: 다른 출처의 추가 요청(출처 검사가 가장 먼저)", () => {
    for (const kind of kinds) {
      it(`관리자로 로그인한 상태에서 다른 출처의 Origin을 붙여 유효한 이름으로 ${kind.label}을 추가하면 403을 받고 아무것도 저장되지 않으며, 같은 요청을 신뢰 출처 Origin으로 보내면 201로 저장된다`, async () => {
        const { agent } = await loginAs("ADMIN");

        const res = await agent.post(kind.path).set("Origin", OTHER).send({ name: "React" });

        expect(res.status).toBe(403);
        expect(typeof res.body.error).toBe("string");
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);

        // 대조: 출처만 신뢰 출처로 바꾸면 관리자 추가가 허용된다(403이 출처 때문임을 확인)
        const trusted = await agent.post(kind.path).set("Origin", TRUSTED).send({ name: "React" });
        expect(trusted.status).toBe(201);
        expect(trusted.body).toEqual({ id: expect.stringMatching(UUID), name: "React" });
        expect(await kind.count()).toBe(1);
      });

      it(`로그인하지 않은 상태에서 다른 출처의 Origin을 붙여 ${kind.label}을 추가하면 로그인 확인보다 출처 검사가 먼저라 401이 아닌 403을 받고 아무것도 저장되지 않으며, Origin 없이 보내면 401이다`, async () => {
        const res = await request(app).post(kind.path).set("Origin", OTHER).send({ name: "React" });

        expect(res.status).toBe(403);
        expect(typeof res.body.error).toBe("string");
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);

        // 대조: 출처 검사가 없으면 이 요청은 로그인 확인에서 401로 거부된다
        const noOrigin = await request(app).post(kind.path).send({ name: "React" });
        expect(noOrigin.status).toBe(401);
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);
      });

      it(`관리자로 로그인한 상태에서 다른 출처의 Origin을 붙여 형식이 틀린 이름으로 ${kind.label}을 추가하면 입력 검증보다 출처 검사가 먼저라 400이 아닌 403을 받고 아무것도 저장되지 않으며, 신뢰 출처로 보내면 400이다`, async () => {
        const { agent } = await loginAs("ADMIN");

        const res = await agent.post(kind.path).set("Origin", OTHER).send({ name: "Re\nact" });

        expect(res.status).toBe(403);
        expect(typeof res.body.error).toBe("string");
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);

        // 대조: 출처만 신뢰 출처로 바꾸면 입력 검증에서 400으로 거부된다
        const trusted = await agent.post(kind.path).set("Origin", TRUSTED).send({ name: "Re\nact" });
        expect(trusted.status).toBe(400);
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);
      });

      it(`관리자로 로그인한 상태에서 다른 출처의 Origin을 붙여 문법이 깨진 JSON 본문으로 ${kind.label}을 추가하면 본문 파싱보다 출처 검사가 먼저라 400이 아닌 403을 받고 아무것도 저장되지 않으며, 신뢰 출처로 보내면 400이고 유효한 본문이면 201이다`, async () => {
        const { agent } = await loginAs("ADMIN");
        const broken = '{"name": "React",';

        const res = await agent
          .post(kind.path)
          .set("Origin", OTHER)
          .set("Content-Type", "application/json")
          .send(broken);

        expect(res.status).toBe(403);
        expect(typeof res.body.error).toBe("string");
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);

        // 대조: 출처만 신뢰 출처로 바꾸면 JSON이 아니므로 400이다
        const trusted = await agent
          .post(kind.path)
          .set("Origin", TRUSTED)
          .set("Content-Type", "application/json")
          .send(broken);
        expect(trusted.status).toBe(400);
        expect(await techStackCount()).toBe(0);
        expect(await positionCount()).toBe(0);

        // 대조: 같은 경로에 신뢰 출처로 유효한 본문을 보내면 추가된다(위 403·400이 이 경로의 응답임을 확인)
        const valid = await agent.post(kind.path).set("Origin", TRUSTED).send({ name: "React" });
        expect(valid.status).toBe(201);
        expect(await kind.count()).toBe(1);
      });
    }
  });

  describe("시나리오 7: 동시 추가", () => {
    for (const kind of kinds) {
      it(`관리자로 로그인했고 같은 이름의 ${kind.label}이 없을 때 같은 이름의 추가 요청 10개가 동시에 들어오면 하나만 201로 저장되고 나머지 9개는 409이며 5xx는 없다`, async () => {
        const { agent } = await loginAs("ADMIN");

        const responses = await Promise.all(
          Array.from({ length: 10 }, () => agent.post(kind.path).send({ name: "React" })),
        );

        const statuses = responses.map((res) => res.status);
        expect(statuses.filter((status) => status >= 500)).toEqual([]);
        expect(statuses.filter((status) => status === 201)).toHaveLength(1);
        expect(statuses.filter((status) => status === 409)).toHaveLength(9);
        expect(await kind.count()).toBe(1);
      });

      it(`관리자로 로그인했고 같은 이름의 ${kind.label}이 없을 때 대소문자만 다른 이름(React·react·REACT·rEaCt)의 추가 요청이 동시에 들어오면 하나만 201로 저장되고 나머지는 409이며 5xx는 없다`, async () => {
        const { agent } = await loginAs("ADMIN");
        const names = ["React", "react", "REACT", "rEaCt", "React", "react", "REACT", "rEaCt"];

        const responses = await Promise.all(names.map((name) => agent.post(kind.path).send({ name })));

        const statuses = responses.map((res) => res.status);
        expect(statuses.filter((status) => status >= 500)).toEqual([]);
        expect(statuses.filter((status) => status === 201)).toHaveLength(1);
        expect(statuses.filter((status) => status === 409)).toHaveLength(names.length - 1);
        expect(await kind.count()).toBe(1);
      });
    }
  });
});
