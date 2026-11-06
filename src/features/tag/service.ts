import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { httpError } from "../../lib/errors.js";
import type { CreateTagInput } from "./dto/request.js";

const conflictOnDuplicateName = async <T>(query: () => Promise<T>) => {
  try {
    return await query();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw httpError(409, "이미 존재하는 이름입니다");
    }
    throw err;
  }
};

export const createTechStack = ({ name }: CreateTagInput) =>
  conflictOnDuplicateName(() => prisma.techStack.create({ data: { name }, select: { id: true, name: true } }));

export const createPosition = ({ name }: CreateTagInput) =>
  conflictOnDuplicateName(() => prisma.position.create({ data: { name }, select: { id: true, name: true } }));
