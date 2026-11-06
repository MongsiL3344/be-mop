import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LOGIN = "/users/login";
// US1과 같은 /tags 라우터 아래 종류별 목록 경로
const TECH_STACKS = "/tags/tech-stacks";
const POSITIONS = "/tags/positions";

// 목록 조회는 상태를 바꾸지 않으므로 다른 출처의 Origin이 붙어도 허용된다
const OTHER = "https://evil.example";

const PASSWORD = "password1";

// 일반 사용자로 로그인한 agent(세션 쿠키 유지)를 돌려준다
const loginAsUser = async () => {
  const user = await prisma.user.create({
    data: {
      email: "user@example.com",
      nickname: "user",
      role: "USER",
      passwordHash: await bcrypt.hash(PASSWORD, 4),
    },
  });
  const agent = request.agent(app);
  const res = await agent.post(LOGIN).send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
};

// 저장소에 이름 순서대로 직접 넣고, 이름 → 저장된 행 맵을 돌려준다
const seedTechStacks = async (names: string[]) => {
  const rows = new Map<string, { id: string; name: string }>();
  for (const name of names) rows.set(name, await prisma.techStack.create({ data: { name } }));
  return rows;
};

const seedPositions = async (names: string[]) => {
  const rows = new Map<string, { id: string; name: string }>();
  for (const name of names) rows.set(name, await prisma.position.create({ data: { name } }));
  return rows;
};

// 기대 순서의 이름 목록을 저장된 행({ id, name })의 목록으로 바꾼다
const itemsOf = (rows: Map<string, { id: string; name: string }>, order: string[]) =>
  order.map((name) => {
    const row = rows.get(name);
    if (!row) throw new Error(`시드되지 않은 이름: ${name}`);
    return { id: row.id, name: row.name };
  });

// 조회 뒤에도 저장소가 그대로인지 확인하기 위한 스냅샷(id 순 정렬)
const snapshot = async () => ({
  techStacks: await prisma.techStack.findMany({ orderBy: { id: "asc" } }),
  positions: await prisma.position.findMany({ orderBy: { id: "asc" } }),
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "TechStack", "Position", "User" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US2 누구나 기술 스택·포지션 목록을 조회한다", () => {
  describe("시나리오 1: 기술 스택 목록(대소문자 무시 이름순)", () => {
    it('기술 스택 "TypeScript"·"jQuery"·"React"·"angular"가 저장돼 있을 때 로그인하지 않고 기술 스택 목록을 조회하면 200과 { items } 형태로 네 개 모두 id·name을 담아 "angular"·"jQuery"·"React"·"TypeScript" 순서로 반환되고 저장소는 바뀌지 않는다', async () => {
      const rows = await seedTechStacks(["TypeScript", "jQuery", "React", "angular"]);
      const before = await snapshot();

      const res = await request(app).get(TECH_STACKS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: itemsOf(rows, ["angular", "jQuery", "React", "TypeScript"]) });
      expect(await snapshot()).toEqual(before);
    });

    it('기술 스택 "TypeScript"·"jQuery"·"React"·"angular"가 저장돼 있을 때 로그인하지 않고 다른 출처의 Origin을 붙여 기술 스택 목록을 조회해도 200과 같은 순서의 목록이 반환되고 저장소는 바뀌지 않는다', async () => {
      const rows = await seedTechStacks(["TypeScript", "jQuery", "React", "angular"]);
      const before = await snapshot();

      const res = await request(app).get(TECH_STACKS).set("Origin", OTHER);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: itemsOf(rows, ["angular", "jQuery", "React", "TypeScript"]) });
      expect(await snapshot()).toEqual(before);
    });

    it('기술 스택 "TypeScript"·"jQuery"·"React"·"angular"와 포지션 "백엔드"가 저장돼 있을 때 로그인하지 않고 기술 스택 목록을 조회하면 200과 함께 기술 스택 네 개만 반환되고 포지션은 섞이지 않는다', async () => {
      const rows = await seedTechStacks(["TypeScript", "jQuery", "React", "angular"]);
      await seedPositions(["백엔드"]);
      const before = await snapshot();

      const res = await request(app).get(TECH_STACKS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: itemsOf(rows, ["angular", "jQuery", "React", "TypeScript"]) });
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("시나리오 2: 포지션 목록(기술 스택과 섞이지 않음)", () => {
    it('포지션 "프론트엔드"·"백엔드"·"DevOps"와 기술 스택 "React"·"DevOps"가 저장돼 있을 때 로그인하지 않고 포지션 목록을 조회하면 200과 함께 "DevOps"·"백엔드"·"프론트엔드" 순서로 포지션 id·name만 반환되고 기술 스택은 섞이지 않는다', async () => {
      const positions = await seedPositions(["프론트엔드", "백엔드", "DevOps"]);
      await seedTechStacks(["React", "DevOps"]);
      const before = await snapshot();

      const res = await request(app).get(POSITIONS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: itemsOf(positions, ["DevOps", "백엔드", "프론트엔드"]) });
      expect(await snapshot()).toEqual(before);
    });

    it('포지션 "프론트엔드"·"백엔드"·"DevOps"가 저장돼 있을 때 로그인하지 않고 다른 출처의 Origin을 붙여 포지션 목록을 조회해도 200과 "DevOps"·"백엔드"·"프론트엔드" 순서의 목록이 반환된다', async () => {
      const positions = await seedPositions(["프론트엔드", "백엔드", "DevOps"]);
      const before = await snapshot();

      const res = await request(app).get(POSITIONS).set("Origin", OTHER);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: itemsOf(positions, ["DevOps", "백엔드", "프론트엔드"]) });
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("시나리오 3: 저장된 태그가 없을 때 빈 목록", () => {
    it("저장된 기술 스택이 없을 때 로그인하지 않고 기술 스택 목록을 조회하면 200과 { items: [] }가 반환되고 저장소는 비어 있다", async () => {
      const res = await request(app).get(TECH_STACKS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
      expect(await prisma.techStack.count()).toBe(0);
    });

    it('저장된 기술 스택은 없고 포지션 "백엔드"만 있을 때 로그인하지 않고 기술 스택 목록을 조회하면 200과 { items: [] }가 반환되고 포지션은 그대로다', async () => {
      const positions = await seedPositions(["백엔드"]);

      const res = await request(app).get(TECH_STACKS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
      expect(await prisma.techStack.count()).toBe(0);
      expect(await prisma.position.findMany()).toEqual(itemsOf(positions, ["백엔드"]));
    });

    it("저장된 포지션이 없을 때 로그인하지 않고 포지션 목록을 조회하면 200과 { items: [] }가 반환되고 저장소는 비어 있다", async () => {
      const res = await request(app).get(POSITIONS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
      expect(await prisma.position.count()).toBe(0);
    });
  });

  describe("시나리오 4: 일반 사용자 로그인 상태에서도 같은 결과", () => {
    it('기술 스택 "TypeScript"·"jQuery"·"React"·"angular"가 저장돼 있고 일반 사용자로 로그인한 상태에서 기술 스택 목록을 조회하면 비로그인 조회와 같은 결과가 200으로 오고 저장소는 바뀌지 않는다', async () => {
      const rows = await seedTechStacks(["TypeScript", "jQuery", "React", "angular"]);
      const agent = await loginAsUser();
      const before = await snapshot();

      const anonymous = await request(app).get(TECH_STACKS);
      const loggedIn = await agent.get(TECH_STACKS);

      expect(loggedIn.status).toBe(200);
      expect(anonymous.status).toBe(200);
      expect(loggedIn.body).toEqual({ items: itemsOf(rows, ["angular", "jQuery", "React", "TypeScript"]) });
      expect(loggedIn.body).toEqual(anonymous.body);
      expect(await snapshot()).toEqual(before);
    });

    it('포지션 "프론트엔드"·"백엔드"·"DevOps"가 저장돼 있고 일반 사용자로 로그인한 상태에서 포지션 목록을 조회하면 비로그인 조회와 같은 결과가 200으로 오고 저장소는 바뀌지 않는다', async () => {
      const positions = await seedPositions(["프론트엔드", "백엔드", "DevOps"]);
      const agent = await loginAsUser();
      const before = await snapshot();

      const anonymous = await request(app).get(POSITIONS);
      const loggedIn = await agent.get(POSITIONS);

      expect(loggedIn.status).toBe(200);
      expect(anonymous.status).toBe(200);
      expect(loggedIn.body).toEqual({ items: itemsOf(positions, ["DevOps", "백엔드", "프론트엔드"]) });
      expect(loggedIn.body).toEqual(anonymous.body);
      expect(await snapshot()).toEqual(before);
    });

    it("저장된 기술 스택이 없고 일반 사용자로 로그인한 상태에서 기술 스택 목록을 조회하면 비로그인과 같은 200과 { items: [] }가 온다", async () => {
      const agent = await loginAsUser();

      const res = await agent.get(TECH_STACKS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
      expect(await prisma.techStack.count()).toBe(0);
    });
  });
});
