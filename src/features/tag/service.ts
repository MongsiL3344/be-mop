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

// 대소문자를 무시한 이름 오름차순. 그 외에는 문자 코드 순서(영문이 한글보다 앞)
const byNameIgnoringCase = (a: { name: string }, b: { name: string }) => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

export const listTechStacks = async () => {
  const items = await prisma.techStack.findMany({ select: { id: true, name: true } });
  return { items: items.sort(byNameIgnoringCase) };
};

export const listPositions = async () => {
  const items = await prisma.position.findMany({ select: { id: true, name: true } });
  return { items: items.sort(byNameIgnoringCase) };
};

export const createTechStack = ({ name }: CreateTagInput) =>
  conflictOnDuplicateName(() => prisma.techStack.create({ data: { name }, select: { id: true, name: true } }));

export const createPosition = ({ name }: CreateTagInput) =>
  conflictOnDuplicateName(() => prisma.position.create({ data: { name }, select: { id: true, name: true } }));
