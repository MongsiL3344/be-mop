import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/db.js";

const LOGIN = "/users/login";
// 프로젝트 기능 라우터는 /projects 한 줄로 마운트되고, 생성은 POST /projects다
const PROJECTS = "/projects";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// 보충 평면 문자(이모지): 문자 1개가 UTF-16 코드 단위 2개라 문자 수와 코드 단위 수가 다르다
const EMOJI = "😀";

const PASSWORD = "password1";

type Tag = { id: string; name: string };
type Fixture = { react: Tag; node: Tag; frontend: Tag; backend: Tag };
type Body = Record<string, unknown>;

const seedUser = async (nickname: string) =>
  prisma.user.create({
    data: {
      email: `${nickname}@example.com`,
      nickname,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
    },
  });

// 사용자를 만들고 로그인한 agent(세션 쿠키 유지)를 돌려준다
const loginAs = async (nickname = "leader") => {
  const user = await seedUser(nickname);
  const agent = request.agent(app);
  const res = await agent.post(LOGIN).send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
};

// 관리자가 등록해 둔 것처럼 태그를 저장소에 직접 넣는다
const seedTags = async (): Promise<Fixture> => ({
  react: await prisma.techStack.create({ data: { name: "React" } }),
  node: await prisma.techStack.create({ data: { name: "Node.js" } }),
  frontend: await prisma.position.create({ data: { name: "프론트엔드" } }),
  backend: await prisma.position.create({ data: { name: "백엔드" } }),
});

// 시나리오 1의 유효한 생성 요청 본문
const validBody = (fx: Fixture): Body => ({
  name: "MOP",
  description: "개발자 팀 매칭 플랫폼",
  techStackIds: [fx.react.id, fx.node.id],
  duration: "M3_TO_6",
  meetingType: "ONLINE",
  positions: [
    { positionId: fx.frontend.id, capacity: 2 },
    { positionId: fx.backend.id, capacity: 1 },
  ],
});

// 생성 결과로 저장되는 네 가지(프로젝트·프로젝트 포지션·기술 스택 연결·팀원 기록)의 개수
const savedCounts = async () => ({
  projects: await prisma.project.count(),
  projectPositions: await prisma.projectPosition.count(),
  projectTechStacks: await prisma.projectTechStack.count(),
  projectMembers: await prisma.projectMember.count(),
});

const NOTHING_SAVED = { projects: 0, projectPositions: 0, projectTechStacks: 0, projectMembers: 0 };

// 태그가 실제로 있는지 함께 확인해, 거부 원인이 태그 부족이 아님을 보장한다
const extraTechStacks = async (count: number) => {
  const created: Tag[] = [];
  for (let i = 1; i <= count; i++) created.push(await prisma.techStack.create({ data: { name: `Tech${i}` } }));
  return created;
};
const extraPositions = async (count: number) => {
  const created: Tag[] = [];
  for (let i = 1; i <= count; i++) created.push(await prisma.position.create({ data: { name: `Position${i}` } }));
  return created;
};

// 저장된 프로젝트에 대한 FR-008 상세 형태(응답 비교용)
const expectedDetail = async (projectId: string) => {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { leader: true } });
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    duration: project.duration,
    meetingType: project.meetingType,
    leader: { id: project.leader.id, nickname: project.leader.nickname },
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
};

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ProjectMember", "ProjectPosition", "ProjectTechStack", "Project", "TechStack", "Position", "User" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("US1 로그인한 사용자가 프로젝트를 만든다", () => {
  describe("시나리오 1: 기술 스택·포지션을 고른 프로젝트 생성 성공", () => {
    it('로그인했고 기술 스택 "React"·"Node.js"와 포지션 "프론트엔드"·"백엔드"가 있을 때 이름 "MOP"·소개·기술 스택 2개·M3_TO_6·ONLINE·포지션 정원 2·1로 만들면 201과 FR-008 상세가 오고 프로젝트 1개·프로젝트 포지션 2개·연결 2개·포지션 없는 팀장 기록 1개가 저장된다', async () => {
      const fx = await seedTags();
      const { agent, user } = await loginAs("leader");

      const res = await agent.post(PROJECTS).send(validBody(fx));

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.stringMatching(UUID),
        name: "MOP",
        description: "개발자 팀 매칭 플랫폼",
        duration: "M3_TO_6",
        meetingType: "ONLINE",
        leader: { id: user.id, nickname: "leader" },
        // 대소문자 무시 이름 오름차순: Node.js < React
        techStacks: [
          { id: fx.node.id, name: "Node.js" },
          { id: fx.react.id, name: "React" },
        ],
        // 대소문자 무시 이름 오름차순: 백엔드 < 프론트엔드
        positions: [
          { id: expect.stringMatching(UUID), position: { id: fx.backend.id, name: "백엔드" }, capacity: 1 },
          { id: expect.stringMatching(UUID), position: { id: fx.frontend.id, name: "프론트엔드" }, capacity: 2 },
        ],
        createdAt: expect.stringMatching(ISO),
        updatedAt: expect.stringMatching(ISO),
      });

      // 저장 상태: 프로젝트 1개
      const projects = await prisma.project.findMany();
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({
        id: res.body.id,
        leaderId: user.id,
        name: "MOP",
        description: "개발자 팀 매칭 플랫폼",
        duration: "M3_TO_6",
        meetingType: "ONLINE",
      });
      expect(res.body).toMatchObject(await expectedDetail(res.body.id));

      // 프로젝트 포지션 2개: 마스터 포지션을 position_id로 참조, 정원 2·1, 응답의 id와 같은 식별자
      const projectPositions = await prisma.projectPosition.findMany({ orderBy: { capacity: "asc" } });
      expect(projectPositions).toEqual([
        { id: res.body.positions[0].id, projectId: res.body.id, positionId: fx.backend.id, capacity: 1 },
        { id: res.body.positions[1].id, projectId: res.body.id, positionId: fx.frontend.id, capacity: 2 },
      ]);

      // 기술 스택 연결 2개
      const links = await prisma.projectTechStack.findMany();
      expect(links).toHaveLength(2);
      expect(links).toEqual(
        expect.arrayContaining([
          { projectId: res.body.id, techStackId: fx.react.id },
          { projectId: res.body.id, techStackId: fx.node.id },
        ]),
      );

      // 만든 사람의 팀장 기록 1개(포지션 없음, 현재 팀원)
      const members = await prisma.projectMember.findMany();
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({
        projectId: res.body.id,
        userId: user.id,
        role: "LEADER",
        projectPositionId: null,
        leftAt: null,
      });
    });

    it("로그인했고 태그가 있을 때 앞뒤 공백이 붙은 이름과 줄바꿈·탭이 든 소개로 만들면 201이고 이름은 앞뒤 공백만 제거되고(사이 공백 유지) 소개의 줄바꿈·탭은 그대로 저장된다", async () => {
      const fx = await seedTags();
      const { agent } = await loginAs();
      const description = "첫 줄\n\t둘째 줄";

      const res = await agent.post(PROJECTS).send({ ...validBody(fx), name: "  MOP  팀 ", description: `  ${description}  ` });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: "MOP  팀", description });
      const projects = await prisma.project.findMany();
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({ id: res.body.id, name: "MOP  팀", description });
    });

    it.each([
      ["생략하면", undefined],
      ["null로 보내면", null],
      ["빈 문자열로 보내면", ""],
      ["공백만 보내면", "   "],
    ])("로그인했고 태그가 있을 때 소개를 %s 201이고 소개 없음(null)으로 응답·저장된다", async (_label, description) => {
      const fx = await seedTags();
      const { agent } = await loginAs();
      const body = validBody(fx);
      if (description === undefined) delete body["description"];
      else body["description"] = description;

      const res = await agent.post(PROJECTS).send(body);

      expect(res.status).toBe(201);
      expect(res.body.description).toBeNull();
      const projects = await prisma.project.findMany();
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({ id: res.body.id, description: null });
    });

    it("로그인했고 기술 스택 20개·포지션 10개가 있을 때 이름 50자(이모지)·소개 2000자·기술 스택 20개·포지션 10개(정원 1과 20 포함)로 만들면 경계값이 모두 허용돼 201이고 그대로 저장된다", async () => {
      const techStacks = await extraTechStacks(20);
      const positions = await extraPositions(10);
      const { agent } = await loginAs();
      const name = EMOJI.repeat(50);
      const description = "가".repeat(2000);

      const res = await agent.post(PROJECTS).send({
        name,
        description,
        duration: "OVER_1Y",
        meetingType: "OFFLINE",
        techStackIds: techStacks.map((t) => t.id),
        positions: positions.map((p, i) => ({ positionId: p.id, capacity: i === 0 ? 1 : 20 })),
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name, description, duration: "OVER_1Y", meetingType: "OFFLINE" });
      expect(res.body.techStacks).toHaveLength(20);
      expect(res.body.positions).toHaveLength(10);
      expect(await savedCounts()).toEqual({ projects: 1, projectPositions: 10, projectTechStacks: 20, projectMembers: 1 });
      const capacities = (await prisma.projectPosition.findMany()).map((p) => p.capacity).sort((a, b) => a - b);
      expect(capacities).toEqual([1, ...Array<number>(9).fill(20)]);
      expect(await prisma.project.findFirst()).toMatchObject({ name, description });
    });

    it("로그인했고 태그가 있을 때 정의되지 않은 추가 필드(id·leaderId·workspaceId 포함)를 덧붙여 만들면 추가 필드는 무시되고 201과 함께 로그인한 사용자를 팀장으로 새 UUID로 저장된다", async () => {
      const fx = await seedTags();
      const other = await seedUser("other");
      const { agent, user } = await loginAs("leader");
      const forgedId = randomUUID();

      const res = await agent
        .post(PROJECTS)
        .send({ ...validBody(fx), id: forgedId, leaderId: other.id, workspaceId: randomUUID(), color: "blue" });

      expect(res.status).toBe(201);
      expect(res.body.id).not.toBe(forgedId);
      expect(res.body.leader).toEqual({ id: user.id, nickname: "leader" });
      expect(res.body).not.toHaveProperty("workspaceId");
      expect(res.body).not.toHaveProperty("color");
      const projects = await prisma.project.findMany();
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({ id: res.body.id, leaderId: user.id });
      const members = await prisma.projectMember.findMany();
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({ userId: user.id, role: "LEADER" });
    });

    it("로그인했고 태그가 있을 때 응답의 팀장 정보에는 id·nickname만 있고 이메일·역할 등 다른 사용자 정보와 팀원 목록은 담기지 않는다", async () => {
      const fx = await seedTags();
      const { agent, user } = await loginAs("leader");

      const res = await agent.post(PROJECTS).send(validBody(fx));

      expect(res.status).toBe(201);
      expect(res.body.leader).toEqual({ id: user.id, nickname: "leader" });
      expect(JSON.stringify(res.body)).not.toContain(user.email);
      expect(res.body).not.toHaveProperty("members");
      expect(await prisma.projectMember.count({ where: { projectId: res.body.id, userId: user.id } })).toBe(1);
    });
  });

  describe("시나리오 2: 기술 스택·포지션 없이 생성", () => {
    it.each([
      ["모두 생략하고", {}],
      ["모두 빈 목록으로 보내고", { techStackIds: [], positions: [] }],
    ])("로그인했을 때 기술 스택과 포지션을 %s 만들면 201이고 연결·프로젝트 포지션은 0개이며 프로젝트와 팀장 기록은 저장된다", async (_label, lists) => {
      await seedTags();
      const { agent, user } = await loginAs("leader");

      const res = await agent.post(PROJECTS).send({ name: "MOP", duration: "UNDER_3M", meetingType: "OFFLINE", ...lists });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.stringMatching(UUID),
        name: "MOP",
        description: null,
        duration: "UNDER_3M",
        meetingType: "OFFLINE",
        leader: { id: user.id, nickname: "leader" },
        techStacks: [],
        positions: [],
        createdAt: expect.stringMatching(ISO),
        updatedAt: expect.stringMatching(ISO),
      });
      expect(await savedCounts()).toEqual({ projects: 1, projectPositions: 0, projectTechStacks: 0, projectMembers: 1 });
      expect(await prisma.project.findFirst()).toMatchObject({ id: res.body.id, leaderId: user.id, name: "MOP" });
      expect(await prisma.projectMember.findFirst()).toMatchObject({
        projectId: res.body.id,
        userId: user.id,
        role: "LEADER",
        projectPositionId: null,
        leftAt: null,
      });
    });
  });

  describe("시나리오 3: FR-003 입력 규칙 위반", () => {
    // fx: 기본 태그, many: 경계 초과용 추가 태그(기술 스택 21개·포지션 11개)
    type Many = { techStacks: Tag[]; positions: Tag[] };
    const cases: [string, (fx: Fixture, many: Many) => Body][] = [
      ["이름 51자", (fx) => ({ ...validBody(fx), name: "a".repeat(51) })],
      ["이름 51자(이모지)", (fx) => ({ ...validBody(fx), name: EMOJI.repeat(51) })],
      ["이름 누락", (fx) => ({ ...validBody(fx), name: undefined })],
      ["이름 빈 문자열", (fx) => ({ ...validBody(fx), name: "" })],
      ["이름 공백만", (fx) => ({ ...validBody(fx), name: "   " })],
      ["이름 null", (fx) => ({ ...validBody(fx), name: null })],
      ["이름 숫자", (fx) => ({ ...validBody(fx), name: 123 })],
      ["이름에 줄바꿈", (fx) => ({ ...validBody(fx), name: "MO\nP" })],
      ["이름에 탭", (fx) => ({ ...validBody(fx), name: "MO\tP" })],
      ["이름에 제어문자(U+0007)", (fx) => ({ ...validBody(fx), name: "MO\u0007P" })],
      ["소개 2001자", (fx) => ({ ...validBody(fx), description: "가".repeat(2001) })],
      ["소개에 줄바꿈·탭 외 제어문자(U+0001)", (fx) => ({ ...validBody(fx), description: "소개\u0001" })],
      ["소개 숫자", (fx) => ({ ...validBody(fx), description: 1 })],
      ["예상 기간 누락", (fx) => ({ ...validBody(fx), duration: undefined })],
      ["예상 기간 소문자", (fx) => ({ ...validBody(fx), duration: "m3_to_6" })],
      ["예상 기간 목록 밖 값", (fx) => ({ ...validBody(fx), duration: "M1_TO_2" })],
      ["회의 방식 누락", (fx) => ({ ...validBody(fx), meetingType: undefined })],
      ["회의 방식 소문자", (fx) => ({ ...validBody(fx), meetingType: "online" })],
      ["회의 방식 목록 밖 값", (fx) => ({ ...validBody(fx), meetingType: "HYBRID" })],
      ["기술 스택 21개", (fx, many) => ({ ...validBody(fx), techStackIds: many.techStacks.map((t) => t.id) })],
      ["기술 스택 목록 null", (fx) => ({ ...validBody(fx), techStackIds: null })],
      ["기술 스택 목록에 null", (fx) => ({ ...validBody(fx), techStackIds: [fx.react.id, null] })],
      ["기술 스택 목록이 배열 아닌 문자열", (fx) => ({ ...validBody(fx), techStackIds: fx.react.id })],
      ["기술 스택 id가 UUID 형식 아닌 값", (fx) => ({ ...validBody(fx), techStackIds: [fx.react.id, "not-a-uuid"] })],
      [
        "포지션 11개",
        (fx, many) => ({ ...validBody(fx), positions: many.positions.map((p) => ({ positionId: p.id, capacity: 1 })) }),
      ],
      ["포지션 목록 null", (fx) => ({ ...validBody(fx), positions: null })],
      ["포지션 목록에 null", (fx) => ({ ...validBody(fx), positions: [{ positionId: fx.frontend.id, capacity: 2 }, null] })],
      ["포지션 목록이 배열 아닌 객체", (fx) => ({ ...validBody(fx), positions: { positionId: fx.frontend.id, capacity: 2 } })],
      ["포지션 id가 UUID 형식 아닌 값", (fx) => ({ ...validBody(fx), positions: [{ positionId: "not-a-uuid", capacity: 2 }] })],
      ["포지션 id 누락", (fx) => ({ ...validBody(fx), positions: [{ capacity: 2 }] })],
      ["정원 0", (fx) => ({ ...validBody(fx), positions: [{ positionId: fx.frontend.id, capacity: 0 }] })],
      ["정원 21", (fx) => ({ ...validBody(fx), positions: [{ positionId: fx.frontend.id, capacity: 21 }] })],
      ["정원 음수", (fx) => ({ ...validBody(fx), positions: [{ positionId: fx.frontend.id, capacity: -1 }] })],
      ["정원 소수", (fx) => ({ ...validBody(fx), positions: [{ positionId: fx.frontend.id, capacity: 1.5 }] })],
      ["정원 문자열", (fx) => ({ ...validBody(fx), positions: [{ positionId: fx.frontend.id, capacity: "2" }] })],
      ["정원 누락", (fx) => ({ ...validBody(fx), positions: [{ positionId: fx.frontend.id }] })],
    ];

    it.each(cases)("로그인했을 때 %s인 요청으로 만들면 400이 오고 프로젝트·프로젝트 포지션·연결·팀원 기록 중 아무것도 저장되지 않는다", async (_label, build) => {
      const fx = await seedTags();
      const many = { techStacks: await extraTechStacks(21), positions: await extraPositions(11) };
      const { agent } = await loginAs();

      const res = await agent.post(PROJECTS).send(build(fx, many));

      expect(res.status).toBe(400);
      expect(await savedCounts()).toEqual(NOTHING_SAVED);
    });
  });

  describe("시나리오 4: 존재하지 않는 태그 id", () => {
    it.each([
      ["기술 스택 id 중 하나가 없는 id", (fx: Fixture) => ({ ...validBody(fx), techStackIds: [fx.react.id, randomUUID()] })],
      ["기술 스택 id가 모두 없는 id", (fx: Fixture) => ({ ...validBody(fx), techStackIds: [randomUUID()] })],
      [
        "포지션 id 중 하나가 없는 id",
        (fx: Fixture) => ({
          ...validBody(fx),
          positions: [
            { positionId: fx.frontend.id, capacity: 2 },
            { positionId: randomUUID(), capacity: 1 },
          ],
        }),
      ],
      ["포지션 id가 모두 없는 id", (fx: Fixture) => ({ ...validBody(fx), positions: [{ positionId: randomUUID(), capacity: 1 }] })],
      ["포지션 id 자리에 기술 스택 id", (fx: Fixture) => ({ ...validBody(fx), positions: [{ positionId: fx.react.id, capacity: 1 }] })],
      ["기술 스택 id 자리에 포지션 id", (fx: Fixture) => ({ ...validBody(fx), techStackIds: [fx.frontend.id] })],
    ])("로그인했을 때 %s가 섞인 요청으로 만들면 400이 오고 아무것도 저장되지 않는다", async (_label, build) => {
      const fx = await seedTags();
      const { agent } = await loginAs();

      const res = await agent.post(PROJECTS).send(build(fx));

      expect(res.status).toBe(400);
      expect(await savedCounts()).toEqual(NOTHING_SAVED);
    });
  });

  describe("시나리오 5: 같은 기술 스택 id 중복", () => {
    it("로그인했을 때 같은 기술 스택 id를 두 번 보내 만들면 400이 오고 아무것도 저장되지 않는다", async () => {
      const fx = await seedTags();
      const { agent } = await loginAs();

      const res = await agent.post(PROJECTS).send({ ...validBody(fx), techStackIds: [fx.react.id, fx.node.id, fx.react.id] });

      expect(res.status).toBe(400);
      expect(await savedCounts()).toEqual(NOTHING_SAVED);
    });
  });

  describe("시나리오 6: 같은 포지션 id 중복", () => {
    it.each([
      ["정원이 같게", 2],
      ["정원이 다르게", 3],
    ])("로그인했을 때 같은 포지션 id를 %s 두 번 보내 만들면 400이 오고 아무것도 저장되지 않는다", async (_label, secondCapacity) => {
      const fx = await seedTags();
      const { agent } = await loginAs();

      const res = await agent.post(PROJECTS).send({
        ...validBody(fx),
        positions: [
          { positionId: fx.frontend.id, capacity: 2 },
          { positionId: fx.backend.id, capacity: 1 },
          { positionId: fx.frontend.id, capacity: secondCapacity },
        ],
      });

      expect(res.status).toBe(400);
      expect(await savedCounts()).toEqual(NOTHING_SAVED);
    });
  });

  describe("시나리오 7: 로그인하지 않은 상태", () => {
    it("로그인하지 않았을 때 유효한 내용으로 만들면 401이 오고 아무것도 저장되지 않는다", async () => {
      const fx = await seedTags();

      const res = await request(app).post(PROJECTS).send(validBody(fx));

      expect(res.status).toBe(401);
      expect(await savedCounts()).toEqual(NOTHING_SAVED);
    });

    it("로그인하지 않았을 때 입력 규칙을 어긴 내용으로 만들어도 로그인 확인이 먼저라 401이 오고 아무것도 저장되지 않는다", async () => {
      const fx = await seedTags();

      const res = await request(app).post(PROJECTS).send({ ...validBody(fx), name: "a".repeat(51) });

      expect(res.status).toBe(401);
      expect(await savedCounts()).toEqual(NOTHING_SAVED);
    });

    it("로그인한 뒤 탈퇴 처리된 사용자의 세션으로 유효한 내용으로 만들면 비로그인과 같은 401이 오고 아무것도 저장되지 않는다", async () => {
      const fx = await seedTags();
      const { agent, user } = await loginAs();
      await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

      const res = await agent.post(PROJECTS).send(validBody(fx));

      expect(res.status).toBe(401);
      expect(await savedCounts()).toEqual(NOTHING_SAVED);
    });
  });

  describe("시나리오 8: 이미 다른 프로젝트의 팀장인 사용자의 추가 생성", () => {
    it("로그인했고 이미 다른 프로젝트의 팀장일 때 새 프로젝트(같은 이름 포함)를 만들면 201이고 두 프로젝트가 각각 자기 팀장 기록을 갖는다", async () => {
      const fx = await seedTags();
      const { agent, user } = await loginAs("leader");
      const first = await agent.post(PROJECTS).send(validBody(fx));
      expect(first.status).toBe(201);

      const res = await agent.post(PROJECTS).send({
        name: "MOP",
        duration: "M6_TO_12",
        meetingType: "OFFLINE",
        techStackIds: [fx.react.id],
        positions: [{ positionId: fx.backend.id, capacity: 3 }],
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(UUID);
      expect(res.body.id).not.toBe(first.body.id);
      expect(res.body).toMatchObject({
        name: "MOP",
        duration: "M6_TO_12",
        meetingType: "OFFLINE",
        leader: { id: user.id, nickname: "leader" },
        techStacks: [{ id: fx.react.id, name: "React" }],
        positions: [{ id: expect.stringMatching(UUID), position: { id: fx.backend.id, name: "백엔드" }, capacity: 3 }],
      });

      const projects = await prisma.project.findMany({ orderBy: { createdAt: "asc" } });
      expect(projects.map((p) => ({ id: p.id, leaderId: p.leaderId }))).toEqual([
        { id: first.body.id, leaderId: user.id },
        { id: res.body.id, leaderId: user.id },
      ]);
      const members = await prisma.projectMember.findMany();
      expect(members).toHaveLength(2);
      expect(members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ projectId: first.body.id, userId: user.id, role: "LEADER", projectPositionId: null, leftAt: null }),
          expect.objectContaining({ projectId: res.body.id, userId: user.id, role: "LEADER", projectPositionId: null, leftAt: null }),
        ]),
      );
      // 각 프로젝트의 포지션·연결은 섞이지 않는다
      expect(await prisma.projectPosition.count({ where: { projectId: first.body.id } })).toBe(2);
      expect(await prisma.projectPosition.count({ where: { projectId: res.body.id } })).toBe(1);
      expect(await prisma.projectTechStack.count({ where: { projectId: first.body.id } })).toBe(2);
      expect(await prisma.projectTechStack.count({ where: { projectId: res.body.id } })).toBe(1);
    });
  });
});
