import { z } from "zod";
import { prisma } from "./db.js";
import { httpError } from "./errors.js";

// 알림 생성 입력: userId = 받는 사람 id, content = 알림 내용(공백만 있으면 400, 길이 제한 없음)
const createNotificationSchema = z.strictObject({
  userId: z.uuid(),
  content: z.string().trim().min(1),
});

/**
 * 다른 기능에서 특정 유저에게 알림을 저장할 때 호출하는 내부용 함수
 * 받는 유저가 없거나 탈퇴했으면 404
 * @example await createNotification(userId, "새 댓글이 달렸어요");
 */
export const createNotification = async (userId: string, content: string) => {
  const data = createNotificationSchema.parse({ userId, content });

  // 탈퇴하지 않은 유저만 알림을 받을 수 있다
  const user = await prisma.user.findFirst({
    where: { id: data.userId, deletedAt: null },
    select: { id: true },
  });
  if (!user) throw httpError(404, "유저를 찾을 수 없습니다");

  return prisma.notification.create({
    data,
    select: { id: true, content: true, readAt: true, createdAt: true },
  });
};
