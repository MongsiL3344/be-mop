import type { RequestHandler } from "express";
import { httpError } from "./errors.js";

const SAFE_METHODS: Record<string, true> = { GET: true, HEAD: true, OPTIONS: true };

/**
 * 상태를 바꾸는 요청(GET·HEAD·OPTIONS 외)의 Origin이 신뢰 출처와 정확히 다르면 403.
 * Origin이 없으면 통과(브라우저 밖 요청·같은 출처). 본문 파싱·세션보다 앞에 걸어야 한다
 * @example app.use(checkOrigin(CLIENT_ORIGIN));
 */
export const checkOrigin =
  (trusted: string): RequestHandler =>
  (req, _res, next) => {
    const origin = req.get("Origin");
    if (!SAFE_METHODS[req.method] && origin !== undefined && origin !== trusted) {
      throw httpError(403, "허용되지 않은 출처입니다");
    }
    next();
  };
