import { z } from "zod";

// 알림 목록 조회 쿼리: cursor = 이전 응답의 nextCursor(알림 id). 없으면 최신부터 조회
// 정의하지 않은 쿼리 키가 있으면 400
export const listNotificationsQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
