import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { httpError } from "../../lib/errors.js";
import type { CreateProjectInput } from "./dto/request.js";

const TAG_NOT_FOUND = "존재하지 않는 기술 스택이나 포지션이 있습니다";

// 대소문자를 무시한 이름 오름차순. 그 외에는 문자 코드 순서(영문이 한글보다 앞)
const byNameIgnoringCase = (a: { name: string }, b: { name: string }) => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

// 프로젝트 상세(FR-008)에 담는 필드
const projectDetailSelect = {
  id: true,
  name: true,
  description: true,
  duration: true,
  meetingType: true,
  leader: { select: { id: true, nickname: true } },
  techStacks: { select: { techStack: { select: { id: true, name: true } } } },
  positions: { select: { id: true, positionId: true, name: true, capacity: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

// 기술 스택 연결을 펼치고 기술 스택·포지션을 대소문자 무시 이름 오름차순으로 정렬한다
const toProjectDetail = ({
  techStacks,
  positions,
  ...project
}: Prisma.ProjectGetPayload<{ select: typeof projectDetailSelect }>) => ({
  ...project,
  techStacks: techStacks.map((link) => link.techStack).sort(byNameIgnoringCase),
  positions: positions.sort(byNameIgnoringCase),
});

/**
 * 프로젝트, 프로젝트 포지션(마스터 이름 복사), 기술 스택 연결, 포지션 없는 팀장 기록을 한 번에 저장하고 상세(FR-008)를 돌려준다.
 * 없는 태그가 섞여 있으면(확인 뒤 동시에 삭제된 경우 포함) 400이며 아무것도 저장하지 않는다
 */
export const createProject = async (
  leaderId: string,
  { name, description, duration, meetingType, techStackIds, positions }: CreateProjectInput,
) => {
  const techStackCount = await prisma.techStack.count({ where: { id: { in: techStackIds } } });
  if (techStackCount !== techStackIds.length) throw httpError(400, TAG_NOT_FOUND);

  const masterPositions = await prisma.position.findMany({
    where: { id: { in: positions.map((p) => p.positionId) } },
    select: { id: true, name: true },
  });
  const projectPositions = positions.map(({ positionId, capacity }) => {
    const master = masterPositions.find((p) => p.id === positionId);
    if (!master) throw httpError(400, TAG_NOT_FOUND);
    return { positionId, name: master.name, capacity };
  });

  try {
    const project = await prisma.project.create({
      data: {
        leaderId,
        name,
        description,
        duration,
        meetingType,
        techStacks: { create: techStackIds.map((techStackId) => ({ techStackId })) },
        positions: { create: projectPositions },
        members: { create: { userId: leaderId, role: "LEADER" } },
      },
      select: projectDetailSelect,
    });
    return toProjectDetail(project);
  } catch (err) {
    // 확인 뒤 저장 전에 고른 태그가 삭제되면 외래 키 위반
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      throw httpError(400, TAG_NOT_FOUND);
    }
    throw err;
  }
};

/**
 * 프로젝트 상세(FR-008)를 돌려준다. 없으면 404, 조회한 사용자가 현재 팀원(팀장 포함, 탈퇴·제외 안 됨)이 아니면 403
 */
export const getProject = async (userId: string, projectId: string) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ...projectDetailSelect,
      members: { where: { userId, leftAt: null }, select: { id: true } },
    },
  });
  if (!project) throw httpError(404, "프로젝트를 찾을 수 없습니다");

  const { members, ...detail } = project;
  if (members.length === 0) throw httpError(403, "프로젝트 팀원만 볼 수 있습니다");
  return toProjectDetail(detail);
};
