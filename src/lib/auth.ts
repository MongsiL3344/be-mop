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

/**
 * 로그인 필수 보호. 세션이 없거나(식별자 없음·만료·위조·폐기) 탈퇴한 사용자면 같은 메시지의 401
 * @example router.get("/me", requireLogin, (req, res) => { req.userId })
 */
export const requireLogin: RequestHandler = async (req, _res, next) => {
  const { userId } = req.session;
  const user = userId
    ? await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } })
    : null;
  if (!user) throw httpError(401, "인증되지 않은 사용자입니다");
  req.userId = user.id;
  next();
};
