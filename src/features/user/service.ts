import bcrypt from "bcrypt";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { httpError } from "../../lib/errors.js";
import { byNameIgnoringCase } from "../../lib/sort.js";
import type { LoginInput, SignupInput, UpdateProfileInput } from "./dto/request.js";

export const signup = async ({ email, password, nickname }: SignupInput) => {
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await prisma.user.create({ data: { email, passwordHash, nickname } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const emailTaken = await prisma.user.findFirst({ where: { email, deletedAt: null } });
      throw httpError(409, emailTaken ? "이미 사용 중인 이메일이에요" : "이미 사용 중인 닉네임이에요");
    }
    throw err;
  }
};

export const login = async ({ email, password }: LoginInput) => {
  const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw httpError(401, "이메일 또는 비밀번호가 올바르지 않아요");
  }
  return { id: user.id, email: user.email, nickname: user.nickname };
};

export const me = (userId: string) =>
  prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, nickname: true } });

// 프로필 조회. 없는 사용자와 탈퇴한 사용자는 구분하지 않고 같은 404
export const getProfile = async (id: string) => {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      nickname: true,
      introduction: true,
      links: true,
      positions: { select: { position: { select: { id: true, name: true } } } },
      techStacks: { select: { techStack: { select: { id: true, name: true } } } },
    },
  });
  if (!user) throw httpError(404, "사용자를 찾을 수 없어요");

  // 연결 테이블 한 겹을 벗겨 { id, name }으로 만들고 태그 목록 API와 같은 규칙으로 정렬
  return {
    id: user.id,
    nickname: user.nickname,
    introduction: user.introduction,
    links: user.links,
    positions: user.positions.map((p) => p.position).sort(byNameIgnoringCase),
    techStacks: user.techStacks.map((t) => t.techStack).sort(byNameIgnoringCase),
  };
};

const TAG_NOT_FOUND = "존재하지 않는 태그가 있어요";

// 내 프로필 수정. 보낸 필드만 바꾸고, 사용자 정보 수정과 태그 연결 교체는 한 트랜잭션으로 처리
export const updateProfile = async (userId: string, input: UpdateProfileInput) => {
  const { techStackIds, positionIds, ...fields } = input;
  try {
    await prisma.$transaction(async (tx) => {
      // 같은 사용자의 동시 수정을 한 줄로 세운다(연결 교체가 서로 섞이지 않게)
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

      // 태그 존재 확인(400)은 닉네임 중복(409)보다 먼저, 아무것도 쓰기 전에
      if (techStackIds && (await tx.techStack.count({ where: { id: { in: techStackIds } } })) !== techStackIds.length) {
        throw httpError(400, TAG_NOT_FOUND);
      }
      if (positionIds && (await tx.position.count({ where: { id: { in: positionIds } } })) !== positionIds.length) {
        throw httpError(400, TAG_NOT_FOUND);
      }

      // 안 보낸 필드는 undefined라 바뀌지 않는다. 닉네임 중복이면 여기서 P2002
      await tx.user.update({ where: { id: userId }, data: fields });

      // 보낸 목록만 전체 교체. []이면 삭제만
      if (techStackIds) {
        await tx.userTechStack.deleteMany({ where: { userId } });
        await tx.userTechStack.createMany({ data: techStackIds.map((techStackId) => ({ userId, techStackId })) });
      }
      if (positionIds) {
        await tx.userPosition.deleteMany({ where: { userId } });
        await tx.userPosition.createMany({ data: positionIds.map((positionId) => ({ userId, positionId })) });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") throw httpError(409, "이미 사용 중인 닉네임이에요");
      // 존재 확인 직후 관리자가 태그를 삭제한 경우
      if (err.code === "P2003") throw httpError(400, TAG_NOT_FOUND);
    }
    throw err;
  }
  return getProfile(userId);
};
