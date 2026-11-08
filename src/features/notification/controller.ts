import { Router } from "express";
import { requireLogin } from "../../lib/auth.js";
import { listNotificationsQuerySchema } from "./dto/request.js";
import { listNotifications } from "./service.js";

export const notificationRouter = Router();

// GET /notifications: 로그인 확인 → 쿼리 검증 → 알림 조회(service) 결과 응답
notificationRouter.get("/", requireLogin, async (req, res) => {
  const query = listNotificationsQuerySchema.parse(req.query);
  res.json(await listNotifications(req.userId, query));
});
