import { prisma } from "../../lib/db.js";
import { httpError } from "../../lib/errors.js";
import type { ListNotificationsQuery } from "./dto/request.js";

const PAGE_SIZE = 20; // 알림 개수

/**
 * 로그인한 유저(받는 사람) 본인의 알림을 최신순으로 20개씩 조회한다
 * cursor는 이전 페이지 마지막 알림의 id. 본인 알림이 아니거나 없으면 400
 */
export const listNotifications = async (userId: string, { cursor }: ListNotificationsQuery) => {
  // 본인 것만 알림이 오도록
  const cursorRow = cursor
    ? await prisma.notification.findFirst({
        where: { id: cursor, userId },
        select: { id: true, createdAt: true },
      })
    : null;
  if (cursor && !cursorRow) throw httpError(400, "유효하지 않은 커서입니다");

  // 다음 페이지가 있는지 알기 위해 1개 더 조회
  const rows = await prisma.notification.findMany({
    where: {
      userId,
      
      ...(cursorRow && {
        OR: [
          { createdAt: { lt: cursorRow.createdAt } },
          { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } },
        ],
      }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    select: { id: true, content: true, readAt: true, createdAt: true },
  });

  const items = rows.slice(0, PAGE_SIZE);
  const nextCursor = rows.length > PAGE_SIZE ? items[items.length - 1]?.id ?? null : null;
  return { items, nextCursor };
};
