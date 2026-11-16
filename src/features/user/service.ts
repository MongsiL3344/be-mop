import bcrypt from "bcrypt";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { httpError } from "../../lib/errors.js";
import { byNameIgnoringCase } from "../../lib/sort.js";
import type { LoginInput, SignupInput } from "./dto/request.js";

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
