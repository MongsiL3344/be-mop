import bcrypt from "bcrypt";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { httpError } from "../../lib/errors.js";
import type { SignupInput } from "./dto/request.js";

export const signup = async ({ email, password, nickname }: SignupInput) => {
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await prisma.user.create({ data: { email, passwordHash, nickname } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const emailTaken = await prisma.user.findFirst({ where: { email, deletedAt: null } });
      throw httpError(409, emailTaken ? "이미 사용 중인 이메일이에요" : "이미 사용 중인 닉네임이에요");
    }
    throw err;
  }
};
