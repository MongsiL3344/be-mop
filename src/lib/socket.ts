import { Server } from "socket.io";

/**
 * 공유 socket.io 서버. 순환의존 방지를 위해 http 서버 없이 만들고 index.ts에서 attach
 * @example io.to(roomId).emit("message", payload);
 */
export const io = new Server();
