import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString });
/**
 * 공유 Prisma 클라이언트. service.ts에서 이걸 import하고, 다른 곳에서 `new PrismaClient()` 금지
 * @example const user = await prisma.user.findUnique({ where: { id } });
 */
export const prisma = new PrismaClient({ adapter });