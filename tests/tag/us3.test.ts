import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, CLIENT_ORIGIN } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LOGIN = "/users/login";
// US1·US2와 같은 /tags 라우터 아래 종류별 경로. 수정 대상 id는 경로 파라미터(/tags/<종류>/:id)로 받는다
const TECH_STACKS = "/tags/tech-stacks";
const POSITIONS = "/tags/positions";

// app.ts의 신뢰 출처와, 그와 다른 출처
const TRUSTED = CLIENT_ORIGIN;
const OTHER = "https://evil.example";

// 보충 평면 문자(이모지): 문자 1개가 UTF-16 코드 단위 2개라 문자 수와 코드 단위 수가 다르다
const EMOJI = "😀";

// 문법이 깨진 JSON 본문
const BROKEN_JSON = '{"name": "React",';

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

// 수정 실패 뒤에도 저장소가 그대로인지 확인하기 위한 스냅샷(id 순 정렬)
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

// 종류 경로와 대상 id로 수정 경로를 만든다
const tagUrl = (path: string, id: string) => `${path}/${id}`;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "TechStack", "Position", "User" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US3 관리자가 기술 스택·포지션 이름을 수정한다", () => {
  describe("시나리오 1: 이름 수정 성공", () => {
    it('관리자로 로그인했고 기술 스택 "Recat"이 있을 때 그 이름을 "React"로 수정하면 200과 같은 id·새 이름을 받고 저장된 이름이 "React"로 바뀐다', async () => {
      const tag = await seedTechStack("Recat");
      const { agent } = await loginAs("ADMIN");

      const res = await agent.patch(tagUrl(TECH_STACKS, tag.id)).send({ name: "React" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: tag.id, name: "React" });
      expect(await prisma.techStack.findMany()).toEqual([{ id: tag.id, name: "React" }]);
      expect(await prisma.position.count()).toBe(0);
    });

    it('관리자로 로그인했고 포지션 "벡엔드"가 있을 때 그 이름을 "백엔드"로 수정하면 200과 같은 id·새 이름을 받고 저장된 이름이 "백엔드"로 바뀐다', async () => {
      const tag = await seedPosition("벡엔드");
      const { agent } = await loginAs("ADMIN");

      const res = await agent.patch(tagUrl(POSITIONS, tag.id)).send({ name: "백엔드" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: tag.id, name: "백엔드" });
      expect(await prisma.position.findMany()).toEqual([{ id: tag.id, name: "백엔드" }]);
      expect(await prisma.techStack.count()).toBe(0);
    });

    it('관리자로 로그인했고 기술 스택 "Recat"·"Vue"와 포지션 "Recat"이 있을 때 기술 스택 "Recat"을 "React"로 수정하면 200을 받고 그 행만 바뀌며 기술 스택 "Vue"와 포지션 "Recat"은 그대로다', async () => {
      const target = await seedTechStack("Recat");
      const vue = await seedTechStack("Vue");
      const position = await seedPosition("Recat");
      const { agent } = await loginAs("ADMIN");

      const res = await agent.patch(tagUrl(TECH_STACKS, target.id)).send({ name: "React" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: target.id, name: "React" });
      expect(await prisma.techStack.findUnique({ where: { id: target.id } })).toEqual({ id: target.id, name: "React" });
      expect(await prisma.techStack.findUnique({ where: { id: vue.id } })).toEqual(vue);
      expect(await prisma.techStack.count()).toBe(2);
      expect(await prisma.position.findMany()).toEqual([position]);
    });

    for (const kind of kinds) {
      it.each([
        ["앞뒤 공백이 붙은 '  React '", "Recat", "  React ", "React"],
        ["자기 자신과 대소문자만 다른 'React'(현재 'react')", "react", "React", "React"],
        ["자기 자신과 완전히 같은 'React'", "React", "React", "React"],
        ["특수문자 'C++'", "C+", "C++", "C++"],
        ["사이 공백(연속 공백 포함) 'Spring  Boot 3'", "Spring", "Spring  Boot 3", "Spring  Boot 3"],
        ["한글 30자", "가", "가".repeat(30), "가".repeat(30)],
        ["이모지(보충 평면 문자) 30자", "a", EMOJI.repeat(30), EMOJI.repeat(30)],
      ])(
        `관리자로 로그인했고 ${kind.label}이 있을 때 이름을 %s로 수정하면 200과 같은 id를 받고 앞뒤 공백만 제거된 입력 표기 그대로 저장된다`,
        async (_label, from, input, expected) => {
          const tag = await kind.seed(from);
          const { agent } = await loginAs("ADMIN");

          const res = await agent.patch(tagUrl(kind.path, tag.id)).send({ name: input });

          expect(res.status).toBe(200);
          expect(res.body).toEqual({ id: tag.id, name: expected });
          expect(await kind.rows()).toEqual([{ id: tag.id, name: expected }]);
        },
      );

      it(`관리자로 로그인했고 ${kind.label} "Recat"이 있을 때 정의되지 않은 추가 필드(다른 id 포함)를 덧붙여 "React"로 수정하면 추가 필드는 무시되고 200과 함께 id는 그대로 이름만 바뀐다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent } = await loginAs("ADMIN");
        const forgedId = randomUUID();

        const res = await agent
          .patch(tagUrl(kind.path, tag.id))
          .send({ name: "React", id: forgedId, color: "blue" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ id: tag.id, name: "React" });
        expect(await kind.rows()).toEqual([{ id: tag.id, name: "React" }]);
      });

      it(`일반 사용자로 로그인한 뒤 저장소에서 역할이 관리자로 바뀌면 다시 로그인하지 않아도 ${kind.label} 이름 수정이 200으로 허용되고 저장된다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent, user } = await loginAs("USER");
        await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });

        const res = await agent.patch(tagUrl(kind.path, tag.id)).send({ name: "React" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ id: tag.id, name: "React" });
        expect(await kind.rows()).toEqual([{ id: tag.id, name: "React" }]);
      });
    }

    it('관리자로 로그인했고 기술 스택에만 "DevOps"가 있을 때 포지션 "데브옵스"를 "DevOps"로 수정하면 다른 목록이라 중복이 아니어서 200을 받고 기술 스택 "DevOps"는 그대로다', async () => {
      const techStack = await seedTechStack("DevOps");
      const tag = await seedPosition("데브옵스");
      const { agent } = await loginAs("ADMIN");

      const res = await agent.patch(tagUrl(POSITIONS, tag.id)).send({ name: "DevOps" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: tag.id, name: "DevOps" });
      expect(await prisma.position.findMany()).toEqual([{ id: tag.id, name: "DevOps" }]);
      expect(await prisma.techStack.findMany()).toEqual([techStack]);
    });

    it('관리자로 로그인했고 포지션에만 "백엔드"가 있을 때 기술 스택 "Backend"를 "백엔드"로 수정하면 다른 목록이라 중복이 아니어서 200을 받고 포지션 "백엔드"는 그대로다', async () => {
      const position = await seedPosition("백엔드");
      const tag = await seedTechStack("Backend");
      const { agent } = await loginAs("ADMIN");

      const res = await agent.patch(tagUrl(TECH_STACKS, tag.id)).send({ name: "백엔드" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: tag.id, name: "백엔드" });
      expect(await prisma.techStack.findMany()).toEqual([{ id: tag.id, name: "백엔드" }]);
      expect(await prisma.position.findMany()).toEqual([position]);
    });
  });

  describe("시나리오 2: 다른 태그와 이름 중복", () => {
    it('관리자로 로그인했고 포지션 "백엔드"·"DevOps"가 있을 때 "백엔드"의 이름을 대소문자만 다른 기존 이름 "devops"로 수정하면 409를 받고 두 포지션 이름은 그대로다', async () => {
      const backend = await seedPosition("백엔드");
      const devops = await seedPosition("DevOps");
      const { agent } = await loginAs("ADMIN");
      const before = await snapshot();

      const res = await agent.patch(tagUrl(POSITIONS, backend.id)).send({ name: "devops" });

      expect(res.status).toBe(409);
      expect(typeof res.body.error).toBe("string");
      expect(await prisma.position.findUnique({ where: { id: backend.id } })).toEqual(backend);
      expect(await prisma.position.findUnique({ where: { id: devops.id } })).toEqual(devops);
      expect(await snapshot()).toEqual(before);
    });

    for (const kind of kinds) {
      it.each([
        ["같은 표기 'React'", "React"],
        ["소문자 'react'", "react"],
        ["대문자 'REACT'", "REACT"],
        ["앞뒤 공백이 붙은 '  react '", "  react "],
      ])(
        `관리자로 로그인했고 ${kind.label} "React"·"Recat"이 있을 때 "Recat"의 이름을 %s로 수정하면 409를 받고 두 이름은 그대로다`,
        async (_label, name) => {
          await kind.seed("React");
          const target = await kind.seed("Recat");
          const { agent } = await loginAs("ADMIN");
          const before = await snapshot();

          const res = await agent.patch(tagUrl(kind.path, target.id)).send({ name });

          expect(res.status).toBe(409);
          expect(typeof res.body.error).toBe("string");
          expect(await snapshot()).toEqual(before);
        },
      );

      it(`관리자로 로그인했고 서로 다른 ${kind.label} 5개가 있을 때 각각을 대소문자만 다른 같은 이름(React·react·REACT·rEaCt·React)으로 동시에 수정하면 하나만 200이고 나머지 4개는 409이며 5xx는 없고 그 이름은 저장소에 하나만 남는다`, async () => {
        const originals = ["Recat", "Raect", "Reactt", "Recta", "Rea ct"];
        const tags: Tag[] = [];
        for (const name of originals) tags.push(await kind.seed(name));
        const targets = ["React", "react", "REACT", "rEaCt", "React"];
        const { agent } = await loginAs("ADMIN");

        const responses = await Promise.all(
          tags.map((tag, index) => agent.patch(tagUrl(kind.path, tag.id)).send({ name: targets[index] })),
        );

        const statuses = responses.map((res) => res.status);
        expect(statuses.filter((status) => status >= 500)).toEqual([]);
        expect(statuses.filter((status) => status === 200)).toHaveLength(1);
        expect(statuses.filter((status) => status === 409)).toHaveLength(4);

        const winner = responses.find((res) => res.status === 200);
        const rows = await kind.rows();
        expect(rows).toHaveLength(5);
        expect(rows.filter((row) => row.name.toLowerCase() === "react")).toEqual([winner?.body]);
        // 409를 받은 태그는 원래 이름 그대로다
        for (const tag of tags) {
          if (tag.id === winner?.body.id) continue;
          expect(rows.find((row) => row.id === tag.id)).toEqual(tag);
        }
      });
    }
  });

  describe("시나리오 3: 존재하지 않는 id", () => {
    for (const kind of kinds) {
      it(`관리자로 로그인했고 ${kind.label} "Recat"이 있을 때 존재하지 않는 id(형식은 올바른 UUID)의 ${kind.label} 이름을 수정하면 404와 에러 메시지를 받고 저장소는 그대로이며, 같은 경로에 있는 id로 보내면 200이다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent } = await loginAs("ADMIN");
        const before = await snapshot();

        const res = await agent.patch(tagUrl(kind.path, randomUUID())).send({ name: "React" });

        expect(res.status).toBe(404);
        expect(typeof res.body.error).toBe("string");
        expect(await snapshot()).toEqual(before);

        // 대조: 같은 경로에 있는 id로 보내면 수정된다(위 404가 라우트 없음이 아니라 대상 없음 때문임을 확인)
        const existing = await agent.patch(tagUrl(kind.path, tag.id)).send({ name: "React" });
        expect(existing.status).toBe(200);
        expect(await kind.rows()).toEqual([{ id: tag.id, name: "React" }]);
      });

      it(`관리자로 로그인했고 ${kind.label} "Recat"을 저장소에서 삭제한 직후 그 id로 이름을 수정하면 404와 에러 메시지를 받고 행은 다시 생기지 않는다`, async () => {
        const tag = await kind.seed("Recat");
        const keep = await kind.seed("Vue");
        await prisma.techStack.deleteMany({ where: { id: tag.id } });
        await prisma.position.deleteMany({ where: { id: tag.id } });
        const { agent } = await loginAs("ADMIN");
        const before = await snapshot();

        const res = await agent.patch(tagUrl(kind.path, tag.id)).send({ name: "React" });

        expect(res.status).toBe(404);
        expect(typeof res.body.error).toBe("string");
        expect(await snapshot()).toEqual(before);
        expect(await kind.rows()).toEqual([keep]);
      });
    }

    it('관리자로 로그인했고 기술 스택 "Recat"만 있을 때 그 기술 스택 id로 포지션 이름을 수정하면 포지션에는 그 id가 없어 404를 받고 기술 스택 이름은 그대로다', async () => {
      const tag = await seedTechStack("Recat");
      const { agent } = await loginAs("ADMIN");

      const res = await agent.patch(tagUrl(POSITIONS, tag.id)).send({ name: "React" });

      expect(res.status).toBe(404);
      expect(typeof res.body.error).toBe("string");
      expect(await prisma.techStack.findMany()).toEqual([tag]);
      expect(await prisma.position.count()).toBe(0);
    });

    it('관리자로 로그인했고 포지션 "벡엔드"만 있을 때 그 포지션 id로 기술 스택 이름을 수정하면 기술 스택에는 그 id가 없어 404를 받고 포지션 이름은 그대로다', async () => {
      const tag = await seedPosition("벡엔드");
      const { agent } = await loginAs("ADMIN");

      const res = await agent.patch(tagUrl(TECH_STACKS, tag.id)).send({ name: "백엔드" });

      expect(res.status).toBe(404);
      expect(typeof res.body.error).toBe("string");
      expect(await prisma.position.findMany()).toEqual([tag]);
      expect(await prisma.techStack.count()).toBe(0);
    });
  });

  describe("시나리오 4: 이름 규칙 위반·id 형식 오류", () => {
    const invalidBodies: [string, object][] = [
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

    const invalidIds: [string, string][] = [
      ["UUID가 아닌 문자열", "not-a-uuid"],
      ["숫자", "12345"],
      ["UUID 뒤에 문자가 더 붙음", `${randomUUID()}0`],
      ["16진수가 아닌 문자가 섞인 UUID 모양", "zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz"],
    ];

    for (const kind of kinds) {
      it.each(invalidBodies)(
        `관리자로 로그인했고 ${kind.label} "Recat"이 있을 때 %s인 본문으로 이름을 수정하면 400을 받고 저장된 이름은 그대로다`,
        async (_label, body) => {
          const tag = await kind.seed("Recat");
          const { agent } = await loginAs("ADMIN");
          const before = await snapshot();

          const res = await agent.patch(tagUrl(kind.path, tag.id)).send(body);

          expect(res.status).toBe(400);
          expect(await snapshot()).toEqual(before);
          expect(await kind.rows()).toEqual([tag]);
        },
      );

      it.each(invalidIds)(
        `관리자로 로그인했고 ${kind.label} "Recat"이 있을 때 id가 %s인 경로로 유효한 이름 "React"로 수정하면 400을 받고 저장된 이름은 그대로다`,
        async (_label, id) => {
          const tag = await kind.seed("Recat");
          const { agent } = await loginAs("ADMIN");
          const before = await snapshot();

          const res = await agent.patch(tagUrl(kind.path, id)).send({ name: "React" });

          expect(res.status).toBe(400);
          expect(await snapshot()).toEqual(before);
          expect(await kind.rows()).toEqual([tag]);
        },
      );

      it(`관리자로 로그인했고 ${kind.label} "Recat"이 있을 때 존재하지 않는 id에 규칙을 어긴 이름으로 수정하면 존재 확인보다 입력 검증이 먼저라 404가 아닌 400을 받고 저장소는 그대로다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent } = await loginAs("ADMIN");
        const before = await snapshot();

        const res = await agent.patch(tagUrl(kind.path, randomUUID())).send({ name: "" });

        expect(res.status).toBe(400);
        expect(await snapshot()).toEqual(before);
        expect(await kind.rows()).toEqual([tag]);
      });

      it(`관리자로 로그인했고 ${kind.label} "Recat"이 있을 때 JSON이 아닌 본문(text/plain)으로 이름을 수정하면 400을 받고 저장된 이름은 그대로다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent } = await loginAs("ADMIN");
        const before = await snapshot();

        const res = await agent.patch(tagUrl(kind.path, tag.id)).set("Content-Type", "text/plain").send("React");

        expect(res.status).toBe(400);
        expect(await snapshot()).toEqual(before);
      });

      it(`관리자로 로그인했고 ${kind.label} "Recat"이 있을 때 문법이 깨진 JSON 본문으로 이름을 수정하면 400을 받고 저장된 이름은 그대로이며, 같은 경로에 유효한 본문을 보내면 200이다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent } = await loginAs("ADMIN");
        const before = await snapshot();

        const res = await agent
          .patch(tagUrl(kind.path, tag.id))
          .set("Content-Type", "application/json")
          .send(BROKEN_JSON);

        expect(res.status).toBe(400);
        expect(await snapshot()).toEqual(before);

        // 대조: 같은 경로에 유효한 본문을 보내면 수정된다(위 400이 이 경로의 응답임을 확인)
        const valid = await agent.patch(tagUrl(kind.path, tag.id)).send({ name: "React" });
        expect(valid.status).toBe(200);
        expect(await kind.rows()).toEqual([{ id: tag.id, name: "React" }]);
      });
    }
  });

  describe("시나리오 5: 일반 사용자 거부", () => {
    for (const kind of kinds) {
      it(`일반 사용자(USER)로 로그인했고 ${kind.label} "Recat"이 있을 때 유효한 이름 "React"로 수정하면 403을 받고 이름은 그대로다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent } = await loginAs("USER");
        const before = await snapshot();

        const res = await agent.patch(tagUrl(kind.path, tag.id)).send({ name: "React" });

        expect(res.status).toBe(403);
        expect(typeof res.body.error).toBe("string");
        expect(await snapshot()).toEqual(before);
        expect(await kind.rows()).toEqual([tag]);
      });

      it(`일반 사용자(USER)로 로그인했고 ${kind.label} "Recat"이 있을 때 규칙을 어긴 이름(숫자)으로 수정하면 입력 검증보다 권한 검사가 먼저라 400이 아닌 403을 받고 이름은 그대로다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent } = await loginAs("USER");
        const before = await snapshot();

        const res = await agent.patch(tagUrl(kind.path, tag.id)).send({ name: 123 });

        expect(res.status).toBe(403);
        expect(await snapshot()).toEqual(before);
      });

      it(`일반 사용자(USER)로 로그인했고 ${kind.label} "Recat"이 있을 때 형식이 틀린 id로 수정하면 입력 검증보다 권한 검사가 먼저라 400이 아닌 403을 받고 이름은 그대로다`, async () => {
        await kind.seed("Recat");
        const { agent } = await loginAs("USER");
        const before = await snapshot();

        const res = await agent.patch(tagUrl(kind.path, "not-a-uuid")).send({ name: "React" });

        expect(res.status).toBe(403);
        expect(await snapshot()).toEqual(before);
      });

      it(`일반 사용자(USER)로 로그인했고 ${kind.label} "Recat"이 있을 때 존재하지 않는 id로 수정하면 존재 확인보다 권한 검사가 먼저라 404가 아닌 403을 받고 이름은 그대로다`, async () => {
        await kind.seed("Recat");
        const { agent } = await loginAs("USER");
        const before = await snapshot();

        const res = await agent.patch(tagUrl(kind.path, randomUUID())).send({ name: "React" });

        expect(res.status).toBe(403);
        expect(await snapshot()).toEqual(before);
      });

      it(`일반 사용자(USER)로 로그인했고 ${kind.label} "Recat"이 있을 때 문법이 깨진 JSON 본문으로 수정하면 권한 검사보다 본문 파싱이 먼저라 400을 받고, 유효한 본문으로 보내면 403이며 이름은 그대로다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent } = await loginAs("USER");
        const before = await snapshot();

        const res = await agent
          .patch(tagUrl(kind.path, tag.id))
          .set("Content-Type", "application/json")
          .send(BROKEN_JSON);

        expect(res.status).toBe(400);
        expect(await snapshot()).toEqual(before);

        // 대조: JSON으로 읽히는 본문이면 권한 검사에서 403으로 거부된다
        const valid = await agent.patch(tagUrl(kind.path, tag.id)).send({ name: "React" });
        expect(valid.status).toBe(403);
        expect(await snapshot()).toEqual(before);
      });

      it(`관리자로 로그인한 뒤 저장소에서 역할이 일반 사용자로 내려가면 다음 ${kind.label} 이름 수정 요청은 403을 받고 이름은 그대로다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent, user } = await loginAs("ADMIN");
        await prisma.user.update({ where: { id: user.id }, data: { role: "USER" } });
        const before = await snapshot();

        const res = await agent.patch(tagUrl(kind.path, tag.id)).send({ name: "React" });

        expect(res.status).toBe(403);
        expect(await snapshot()).toEqual(before);
        expect(await kind.rows()).toEqual([tag]);
      });
    }
  });

  describe("시나리오 6: 비로그인 거부", () => {
    for (const kind of kinds) {
      it(`로그인하지 않았고 ${kind.label} "Recat"이 있을 때 유효한 이름 "React"로 수정하면 401을 받고 이름은 그대로다`, async () => {
        const tag = await kind.seed("Recat");
        const before = await snapshot();

        const res = await request(app).patch(tagUrl(kind.path, tag.id)).send({ name: "React" });

        expect(res.status).toBe(401);
        expect(typeof res.body.error).toBe("string");
        expect(await snapshot()).toEqual(before);
        expect(await kind.rows()).toEqual([tag]);
      });

      it(`로그인하지 않았고 ${kind.label} "Recat"이 있을 때 규칙을 어긴 이름(빈 문자열)으로 수정하면 입력 검증보다 로그인 확인이 먼저라 401을 받고 이름은 그대로다`, async () => {
        const tag = await kind.seed("Recat");
        const before = await snapshot();

        const res = await request(app).patch(tagUrl(kind.path, tag.id)).send({ name: "" });

        expect(res.status).toBe(401);
        expect(await snapshot()).toEqual(before);
      });

      it(`로그인하지 않았고 ${kind.label} "Recat"이 있을 때 형식이 틀린 id나 존재하지 않는 id로 수정해도 로그인 확인이 먼저라 401을 받고 이름은 그대로다`, async () => {
        await kind.seed("Recat");
        const before = await snapshot();

        const badId = await request(app).patch(tagUrl(kind.path, "not-a-uuid")).send({ name: "React" });
        const missing = await request(app).patch(tagUrl(kind.path, randomUUID())).send({ name: "React" });

        expect(badId.status).toBe(401);
        expect(missing.status).toBe(401);
        expect(await snapshot()).toEqual(before);
      });

      it(`로그인하지 않았고 ${kind.label} "Recat"이 있을 때 문법이 깨진 JSON 본문으로 수정하면 로그인 확인보다 본문 파싱이 먼저라 400을 받고, 유효한 본문으로 보내면 401이며 이름은 그대로다`, async () => {
        const tag = await kind.seed("Recat");
        const before = await snapshot();

        const res = await request(app)
          .patch(tagUrl(kind.path, tag.id))
          .set("Content-Type", "application/json")
          .send(BROKEN_JSON);

        expect(res.status).toBe(400);
        expect(await snapshot()).toEqual(before);

        // 대조: JSON으로 읽히는 본문이면 로그인 확인에서 401로 거부된다
        const valid = await request(app).patch(tagUrl(kind.path, tag.id)).send({ name: "React" });
        expect(valid.status).toBe(401);
        expect(await snapshot()).toEqual(before);
      });

      it(`탈퇴 처리된 관리자 계정의 로그인 상태로 ${kind.label} "Recat"의 이름을 "React"로 수정하면 비로그인과 같은 401을 받고 이름은 그대로다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent, user } = await loginAs("ADMIN");
        await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
        const before = await snapshot();

        const res = await agent.patch(tagUrl(kind.path, tag.id)).send({ name: "React" });

        expect(res.status).toBe(401);
        expect(await snapshot()).toEqual(before);
        expect(await kind.rows()).toEqual([tag]);
      });
    }
  });

  describe("시나리오 5·6 보충: 다른 출처의 수정 요청(출처 검사가 가장 먼저)", () => {
    for (const kind of kinds) {
      it(`관리자로 로그인했고 ${kind.label} "Recat"이 있을 때 다른 출처의 Origin을 붙여 "React"로 수정하면 403을 받고 이름은 그대로이며, 같은 요청을 신뢰 출처 Origin으로 보내면 200으로 수정된다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent } = await loginAs("ADMIN");
        const before = await snapshot();

        const res = await agent.patch(tagUrl(kind.path, tag.id)).set("Origin", OTHER).send({ name: "React" });

        expect(res.status).toBe(403);
        expect(typeof res.body.error).toBe("string");
        expect(await snapshot()).toEqual(before);

        // 대조: 출처만 신뢰 출처로 바꾸면 관리자 수정이 허용된다(403이 출처 때문임을 확인)
        const trusted = await agent.patch(tagUrl(kind.path, tag.id)).set("Origin", TRUSTED).send({ name: "React" });
        expect(trusted.status).toBe(200);
        expect(trusted.body).toEqual({ id: tag.id, name: "React" });
        expect(await kind.rows()).toEqual([{ id: tag.id, name: "React" }]);
      });

      it(`로그인하지 않았고 ${kind.label} "Recat"이 있을 때 다른 출처의 Origin을 붙여 수정하면 로그인 확인보다 출처 검사가 먼저라 401이 아닌 403을 받고 이름은 그대로이며, Origin 없이 보내면 401이다`, async () => {
        const tag = await kind.seed("Recat");
        const before = await snapshot();

        const res = await request(app).patch(tagUrl(kind.path, tag.id)).set("Origin", OTHER).send({ name: "React" });

        expect(res.status).toBe(403);
        expect(typeof res.body.error).toBe("string");
        expect(await snapshot()).toEqual(before);

        // 대조: 출처 검사가 없으면 이 요청은 로그인 확인에서 401로 거부된다
        const noOrigin = await request(app).patch(tagUrl(kind.path, tag.id)).send({ name: "React" });
        expect(noOrigin.status).toBe(401);
        expect(await snapshot()).toEqual(before);
      });

      it(`관리자로 로그인했고 ${kind.label} "Recat"이 있을 때 다른 출처의 Origin을 붙여 규칙을 어긴 이름으로 수정하면 입력 검증보다 출처 검사가 먼저라 400이 아닌 403을 받고, 신뢰 출처로 보내면 400이며 이름은 그대로다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent } = await loginAs("ADMIN");
        const before = await snapshot();

        const res = await agent.patch(tagUrl(kind.path, tag.id)).set("Origin", OTHER).send({ name: "Re\nact" });

        expect(res.status).toBe(403);
        expect(typeof res.body.error).toBe("string");
        expect(await snapshot()).toEqual(before);

        // 대조: 출처만 신뢰 출처로 바꾸면 입력 검증에서 400으로 거부된다
        const trusted = await agent
          .patch(tagUrl(kind.path, tag.id))
          .set("Origin", TRUSTED)
          .send({ name: "Re\nact" });
        expect(trusted.status).toBe(400);
        expect(await snapshot()).toEqual(before);
      });

      it(`관리자로 로그인했고 ${kind.label} "Recat"이 있을 때 다른 출처의 Origin을 붙여 문법이 깨진 JSON 본문으로 수정하면 본문 파싱보다 출처 검사가 먼저라 400이 아닌 403을 받고 이름은 그대로이며, 같은 본문을 신뢰 출처로 보내면 400이고, 신뢰 출처로 올바른 본문을 보내면 200으로 수정된다`, async () => {
        const tag = await kind.seed("Recat");
        const { agent } = await loginAs("ADMIN");
        const before = await snapshot();

        const res = await agent
          .patch(tagUrl(kind.path, tag.id))
          .set("Origin", OTHER)
          .set("Content-Type", "application/json")
          .send(BROKEN_JSON);

        expect(res.status).toBe(403);
        expect(typeof res.body.error).toBe("string");
        expect(await snapshot()).toEqual(before);

        // 대조: 출처만 신뢰 출처로 바꾸면 같은 본문은 본문 파싱에서 400으로 거부된다
        const trustedBroken = await agent
          .patch(tagUrl(kind.path, tag.id))
          .set("Origin", TRUSTED)
          .set("Content-Type", "application/json")
          .send(BROKEN_JSON);
        expect(trustedBroken.status).toBe(400);
        expect(await snapshot()).toEqual(before);

        // 대조: 신뢰 출처 + 올바른 본문이면 관리자 수정이 허용된다(403·400이 출처·본문 때문임을 확인)
        const trustedValid = await agent
          .patch(tagUrl(kind.path, tag.id))
          .set("Origin", TRUSTED)
          .send({ name: "React" });
        expect(trustedValid.status).toBe(200);
        expect(trustedValid.body).toEqual({ id: tag.id, name: "React" });
        expect(await kind.rows()).toEqual([{ id: tag.id, name: "React" }]);
      });
    }
  });
});
