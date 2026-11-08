import type { RequestHandler } from "express";
import { prisma } from "./db.js";
import { httpError } from "./errors.js";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      /** requireLogin을 통과한 요청에서만 채워지는 로그인 사용자 id(UUID) */
      userId: string;
    }
  }
}

/** 세션의 로그인 사용자(탈퇴 제외)를 저장소에서 읽는다. 없으면(식별자 없음·만료·위조·폐기·탈퇴) 같은 메시지의 401 */
const findLoginUser = async (userId: string | undefined) => {
  const user = userId
    ? await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, role: true } })
    : null;
  if (!user) throw httpError(401, "인증되지 않은 사용자입니다");
  return user;
};

/**
 * 로그인 필수 보호. 세션이 없거나(식별자 없음·만료·위조·폐기) 탈퇴한 사용자면 같은 메시지의 401
 * @example router.get("/me", requireLogin, (req, res) => { req.userId })
 */
export const requireLogin: RequestHandler = async (req, _res, next) => {
  const user = await findLoginUser(req.session.userId);
  req.userId = user.id;
  next();
};

/**
 * 관리자 전용 보호. 로그인 필수 보호와 같은 401, 요청 시점에 저장된 역할이 관리자가 아니면 403.
 * 입력 검증보다 먼저 걸어야 한다
 * @example router.post("/tech-stacks", requireAdmin, (req, res) => { req.userId })
 */
export const requireAdmin: RequestHandler = async (req, _res, next) => {
  const user = await findLoginUser(req.session.userId);
  if (user.role !== "ADMIN") throw httpError(403, "관리자만 할 수 있습니다");
  req.userId = user.id;
  next();
};
