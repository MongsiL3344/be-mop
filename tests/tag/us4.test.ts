import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, CLIENT_ORIGIN } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LOGIN = "/users/login";
// US1~US3과 같은 /tags 라우터 아래 종류별 경로. 삭제 대상 id는 경로 파라미터(/tags/<종류>/:id)로 받는다
const TECH_STACKS = "/tags/tech-stacks";
const POSITIONS = "/tags/positions";

// app.ts의 신뢰 출처와, 그와 다른 출처
const TRUSTED = CLIENT_ORIGIN;
const OTHER = "https://evil.example";

const PASSWORD = "password1";

type Role = "USER" | "ADMIN";
type Tag = { id: string; name: string };

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

// 저장소에 태그를 직접 넣는다
const seedTechStack = (name: string): Promise<Tag> => prisma.techStack.create({ data: { name } });
const seedPosition = (name: string): Promise<Tag> => prisma.position.create({ data: { name } });

// 삭제 실패 뒤에도 저장소가 그대로인지 확인하기 위한 스냅샷(id 순 정렬)
const snapshot = async () => ({
  techStacks: await prisma.techStack.findMany({ orderBy: { id: "asc" } }),
  positions: await prisma.position.findMany({ orderBy: { id: "asc" } }),
});

// 두 종류(기술 스택·포지션)를 같은 규칙으로 검증하기 위한 표
const kinds = [
  {
    label: "기술 스택",
    path: TECH_STACKS,
    seed: seedTechStack,
    rows: (): Promise<Tag[]> => prisma.techStack.findMany({ orderBy: { id: "asc" } }),
  },
  {
    label: "포지션",
    path: POSITIONS,
    seed: seedPosition,
    rows: (): Promise<Tag[]> => prisma.position.findMany({ orderBy: { id: "asc" } }),
  },
] as const;

// 종류 경로와 대상 id로 삭제 경로를 만든다
const tagUrl = (path: string, id: string) => `${path}/${id}`;

// 형식이 올바르지 않은 id들
const invalidIds: [string, string][] = [
  ["UUID가 아닌 문자열", "not-a-uuid"],
  ["숫자", "12345"],
  ["UUID 뒤에 문자가 더 붙음", `${randomUUID()}0`],
  ["16진수가 아닌 문자가 섞인 UUID 모양", "zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz"],
];

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "TechStack", "Position", "User" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US4 관리자가 기술 스택·포지션을 삭제한다", () => {
  describe("시나리오 1: 기술 스택 삭제 성공", () => {
    it('관리자로 로그인했고 기술 스택 "jQuery"가 있을 때 그 기술 스택을 삭제하면 204 빈 본문을 받고 저장소에서 사라지며 이후 기술 스택 목록에도 나오지 않는다', async () => {
      const target = await seedTechStack("jQuery");
      const react = await seedTechStack("React");
      const position = await seedPosition("jQuery");
      const { agent } = await loginAs("ADMIN");

      const res = await agent.delete(tagUrl(TECH_STACKS, target.id));

      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expect(await prisma.techStack.findUnique({ where: { id: target.id } })).toBeNull();
      // 그 행만 지워지고 같은 목록의 다른 태그와 다른 목록의 같은 이름 태그는 그대로다
      expect(await prisma.techStack.findMany()).toEqual([react]);
      expect(await prisma.position.findMany()).toEqual([position]);

      const list = await request(app).get(TECH_STACKS);
      expect(list.status).toBe(200);
      expect(list.body).toEqual({ items: [react] });
    });
  });

  describe("시나리오 2: 포지션 삭제 성공과 같은 이름 다시 추가", () => {
    it('관리자로 로그인했고 포지션 "퍼블리셔"가 있을 때 그 포지션을 삭제하면 204를 받고 저장소에서 사라지며, 같은 이름의 포지션을 다시 추가하면 201이고 새 id로 저장된다', async () => {
      const target = await seedPosition("퍼블리셔");
      const backend = await seedPosition("백엔드");
      const techStack = await seedTechStack("퍼블리셔");
      const { agent } = await loginAs("ADMIN");

      const res = await agent.delete(tagUrl(POSITIONS, target.id));

      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expect(await prisma.position.findUnique({ where: { id: target.id } })).toBeNull();
      expect(await prisma.position.findMany()).toEqual([backend]);
      expect(await prisma.techStack.findMany()).toEqual([techStack]);

      const list = await request(app).get(POSITIONS);
      expect(list.status).toBe(200);
      expect(list.body).toEqual({ items: [backend] });

      // 같은 이름을 다시 추가할 수 있다
      const created = await agent.post(POSITIONS).send({ name: "퍼블리셔" });
      expect(created.status).toBe(201);
      expect(created.body.name).toBe("퍼블리셔");
      expect(created.body.id).not.toBe(target.id);
      expect(await prisma.position.findUnique({ where: { id: created.body.id } })).toEqual({
        id: created.body.id,
        name: "퍼블리셔",
      });
      expect(await prisma.position.count()).toBe(2);
    });
  });

  describe("시나리오 3: 존재하지 않는(또는 이미 삭제된) id", () => {
    for (const kind of kinds) {
      it(`관리자로 로그인했고 ${kind.label} "jQuery"가 있을 때 존재하지 않는 id(형식은 올바른 UUID)의 ${kind.label}을 삭제하면 404와 에러 메시지를 받고 저장소는 그대로이며, 같은 경로에 있는 id로 보내면 204다`, async () => {
        const tag = await kind.seed("jQuery");
        const { agent } = await loginAs("ADMIN");
        const before = await snapshot();

        const res = await agent.delete(tagUrl(kind.path, randomUUID()));

        expect(res.status).toBe(404);
        expect(typeof res.body.error).toBe("string");
        expect(await snapshot()).toEqual(before);

        // 대조: 같은 경로에 있는 id로 보내면 삭제된다(위 404가 라우트 없음이 아니라 대상 없음 때문임을 확인)
        const existing = await agent.delete(tagUrl(kind.path, tag.id));
        expect(existing.status).toBe(204);
        expect(await kind.rows()).toEqual([]);
      });

      it(`관리자로 로그인했고 ${kind.label} "jQuery"·"React"가 있을 때 "jQuery"를 삭제한 뒤 같은 id로 다시 삭제하면 처음은 204, 두 번째는 404와 에러 메시지를 받고 "React"는 그대로다`, async () => {
        const tag = await kind.seed("jQuery");
        const keep = await kind.seed("React");
        const { agent } = await loginAs("ADMIN");

        const first = await agent.delete(tagUrl(kind.path, tag.id));
        expect(first.status).toBe(204);
        expect(await kind.rows()).toEqual([keep]);

        const second = await agent.delete(tagUrl(kind.path, tag.id));
        expect(second.status).toBe(404);
        expect(typeof second.body.error).toBe("string");
        expect(await kind.rows()).toEqual([keep]);
      });
    }

    it('관리자로 로그인했고 기술 스택 "jQuery"만 있을 때 그 기술 스택 id로 포지션을 삭제하면 포지션에는 그 id가 없어 404를 받고 기술 스택은 그대로다', async () => {
      const tag = await seedTechStack("jQuery");
      const { agent } = await loginAs("ADMIN");

      const res = await agent.delete(tagUrl(POSITIONS, tag.id));

      expect(res.status).toBe(404);
      expect(typeof res.body.error).toBe("string");
      expect(await prisma.techStack.findMany()).toEqual([tag]);
      expect(await prisma.position.count()).toBe(0);
    });

    it('관리자로 로그인했고 포지션 "퍼블리셔"만 있을 때 그 포지션 id로 기술 스택을 삭제하면 기술 스택에는 그 id가 없어 404를 받고 포지션은 그대로다', async () => {
      const tag = await seedPosition("퍼블리셔");
      const { agent } = await loginAs("ADMIN");

      const res = await agent.delete(tagUrl(TECH_STACKS, tag.id));

      expect(res.status).toBe(404);
      expect(typeof res.body.error).toBe("string");
      expect(await prisma.position.findMany()).toEqual([tag]);
      expect(await prisma.techStack.count()).toBe(0);
    });
  });

  describe("시나리오 4: id 형식 오류", () => {
    for (const kind of kinds) {
      it.each(invalidIds)(
        `관리자로 로그인했고 ${kind.label} "jQuery"가 있을 때 id가 %s인 경로로 삭제하면 400을 받고 저장소는 그대로다`,
        async (_label, id) => {
          const tag = await kind.seed("jQuery");
          const { agent } = await loginAs("ADMIN");
          const before = await snapshot();

          const res = await agent.delete(tagUrl(kind.path, id));

          expect(res.status).toBe(400);
          expect(await snapshot()).toEqual(before);
          expect(await kind.rows()).toEqual([tag]);
        },
      );
    }
  });

  describe("시나리오 5: 일반 사용자 거부", () => {
    for (const kind of kinds) {
      it(`일반 사용자(USER)로 로그인했고 ${kind.label} "jQuery"가 있을 때 그 ${kind.label}을 삭제하면 403과 에러 메시지를 받고 태그는 그대로 남는다`, async () => {
        const tag = await kind.seed("jQuery");
        const { agent } = await loginAs("USER");
        const before = await snapshot();

        const res = await agent.delete(tagUrl(kind.path, tag.id));

        expect(res.status).toBe(403);
        expect(typeof res.body.error).toBe("string");
        expect(await snapshot()).toEqual(before);
        expect(await kind.rows()).toEqual([tag]);
      });

      it(`일반 사용자(USER)로 로그인했고 ${kind.label} "jQuery"가 있을 때 형식이 틀린 id나 존재하지 않는 id로 삭제해도 입력 검증·존재 확인보다 권한 검사가 먼저라 403을 받고 태그는 그대로 남는다`, async () => {
        const tag = await kind.seed("jQuery");
        const { agent } = await loginAs("USER");
        const before = await snapshot();

        const badId = await agent.delete(tagUrl(kind.path, "not-a-uuid"));
        const missing = await agent.delete(tagUrl(kind.path, randomUUID()));

        expect(badId.status).toBe(403);
        expect(missing.status).toBe(403);
        expect(await snapshot()).toEqual(before);
        expect(await kind.rows()).toEqual([tag]);
      });

      it(`관리자로 로그인한 뒤 저장소에서 역할이 일반 사용자로 내려가면 다음 ${kind.label} 삭제 요청은 403을 받고 태그는 그대로 남는다`, async () => {
        const tag = await kind.seed("jQuery");
        const { agent, user } = await loginAs("ADMIN");
        await prisma.user.update({ where: { id: user.id }, data: { role: "USER" } });
        const before = await snapshot();

        const res = await agent.delete(tagUrl(kind.path, tag.id));

        expect(res.status).toBe(403);
        expect(await snapshot()).toEqual(before);
        expect(await kind.rows()).toEqual([tag]);
      });

      it(`일반 사용자로 로그인한 뒤 저장소에서 역할이 관리자로 바뀌면 다시 로그인하지 않아도 ${kind.label} 삭제가 204로 허용되고 저장소에서 사라진다`, async () => {
        const tag = await kind.seed("jQuery");
        const { agent, user } = await loginAs("USER");
        await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });

        const res = await agent.delete(tagUrl(kind.path, tag.id));

        expect(res.status).toBe(204);
        expect(await kind.rows()).toEqual([]);
      });
    }
  });

  describe("시나리오 6: 비로그인 거부", () => {
    for (const kind of kinds) {
      it(`로그인하지 않았고 ${kind.label} "jQuery"가 있을 때 그 ${kind.label}을 삭제하면 401과 에러 메시지를 받고 태그는 그대로 남는다`, async () => {
        const tag = await kind.seed("jQuery");
        const before = await snapshot();

        const res = await request(app).delete(tagUrl(kind.path, tag.id));

        expect(res.status).toBe(401);
        expect(typeof res.body.error).toBe("string");
        expect(await snapshot()).toEqual(before);
        expect(await kind.rows()).toEqual([tag]);
      });

      it(`로그인하지 않았고 ${kind.label} "jQuery"가 있을 때 형식이 틀린 id나 존재하지 않는 id로 삭제해도 로그인 확인이 먼저라 401을 받고 태그는 그대로 남는다`, async () => {
        const tag = await kind.seed("jQuery");
        const before = await snapshot();

        const badId = await request(app).delete(tagUrl(kind.path, "not-a-uuid"));
        const missing = await request(app).delete(tagUrl(kind.path, randomUUID()));

        expect(badId.status).toBe(401);
        expect(missing.status).toBe(401);
        expect(await snapshot()).toEqual(before);
        expect(await kind.rows()).toEqual([tag]);
      });

      it(`탈퇴 처리된 관리자 계정의 로그인 상태로 ${kind.label} "jQuery"를 삭제하면 비로그인과 같은 401을 받고 태그는 그대로 남는다`, async () => {
        const tag = await kind.seed("jQuery");
        const { agent, user } = await loginAs("ADMIN");
        await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
        const before = await snapshot();

        const res = await agent.delete(tagUrl(kind.path, tag.id));

        expect(res.status).toBe(401);
        expect(await snapshot()).toEqual(before);
        expect(await kind.rows()).toEqual([tag]);
      });
    }
  });

  describe("시나리오 5·6 보충: 다른 출처의 삭제 요청(출처 검사가 가장 먼저)", () => {
    for (const kind of kinds) {
      it(`관리자로 로그인했고 ${kind.label} "jQuery"가 있을 때 다른 출처의 Origin을 붙여 삭제하면 403을 받고 태그는 그대로 남으며, 같은 요청을 신뢰 출처 Origin으로 보내면 204로 삭제된다`, async () => {
        const tag = await kind.seed("jQuery");
        const { agent } = await loginAs("ADMIN");
        const before = await snapshot();

        const res = await agent.delete(tagUrl(kind.path, tag.id)).set("Origin", OTHER);

        expect(res.status).toBe(403);
        expect(typeof res.body.error).toBe("string");
        expect(await snapshot()).toEqual(before);

        // 대조: 출처만 신뢰 출처로 바꾸면 관리자 삭제가 허용된다(403이 출처 때문임을 확인)
        const trusted = await agent.delete(tagUrl(kind.path, tag.id)).set("Origin", TRUSTED);
        expect(trusted.status).toBe(204);
        expect(await kind.rows()).toEqual([]);
      });

      it(`로그인하지 않았고 ${kind.label} "jQuery"가 있을 때 다른 출처의 Origin을 붙여 삭제하면 로그인 확인보다 출처 검사가 먼저라 401이 아닌 403을 받고 태그는 그대로 남으며, Origin 없이 보내면 401이다`, async () => {
        const tag = await kind.seed("jQuery");
        const before = await snapshot();

        const res = await request(app).delete(tagUrl(kind.path, tag.id)).set("Origin", OTHER);

        expect(res.status).toBe(403);
        expect(typeof res.body.error).toBe("string");
        expect(await snapshot()).toEqual(before);

        // 대조: 출처 검사가 없으면 이 요청은 로그인 확인에서 401로 거부된다
        const noOrigin = await request(app).delete(tagUrl(kind.path, tag.id));
        expect(noOrigin.status).toBe(401);
        expect(await snapshot()).toEqual(before);
        expect(await kind.rows()).toEqual([tag]);
      });
    }
  });
});
