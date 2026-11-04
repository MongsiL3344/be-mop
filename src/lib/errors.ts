import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

/**
 * HTTP 상태 코드가 붙은 Error를 만든다. errorHandler가 그 코드로 응답
 * @example throw httpError(404, "방이 없어요");
 */
export const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);

  // Zod 에러
  if (err instanceof ZodError) {
    res.status(400).json({ error: "invalid request", issues: err.issues });
    return;
  }

  // JSON 구문 오류: body-parser 메시지에 요청 본문(비밀번호 등)이 섞이므로 고정 메시지로 응답
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "invalid request" });
    return;
  }

  // 그 외 HTTP 에러
  if (err instanceof Error && "status" in err && typeof err.status === "number") {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "internal server error" });
};
