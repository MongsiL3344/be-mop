import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const signupSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(8)
    .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "비밀번호는 UTF-8 72바이트 이하여야 합니다")
    .regex(/[A-Za-z]/, "비밀번호에 영문자가 1자 이상 있어야 합니다")
    .regex(/[0-9]/, "비밀번호에 숫자가 1자 이상 있어야 합니다"),
  nickname: z.string().trim().min(2).max(20),
});

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1)
    .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "비밀번호는 UTF-8 72바이트 이하여야 합니다"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const userIdParamSchema = z.object({
  id: z.uuid(),
});

// 태그 ID 목록: UUID 형식, 최대 개수, 같은 ID 중복 금지
const tagIdsSchema = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, "같은 ID를 중복으로 보낼 수 없습니다");

// 프로필 수정. 모든 필드는 선택이고 보낸 필드만 바뀐다
export const updateProfileSchema = z.object({
  nickname: z.string().trim().min(2).max(20).exactOptional(),
  // 앞뒤 공백 제거 후 최대 100자(문자 수 기준). null 또는 빈 문자열이면 null로 저장
  introduction: z
    .string()
    .trim()
    .refine((s) => [...s].length <= 100, "소개는 100자 이하여야 합니다")
    .nullable()
    .transform((s) => (s === "" ? null : s))
    .exactOptional(),
  links: z.array(z.httpUrl()).max(5).exactOptional(),
  techStackIds: tagIdsSchema(20).optional(),
  positionIds: tagIdsSchema(10).optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
