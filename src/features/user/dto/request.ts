import { z } from "zod";

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z
    .string()
    .min(8)
    .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "비밀번호는 UTF-8 72바이트 이하여야 합니다")
    .regex(/[A-Za-z]/, "비밀번호에 영문자가 1자 이상 있어야 합니다")
    .regex(/[0-9]/, "비밀번호에 숫자가 1자 이상 있어야 합니다"),
  nickname: z.string().trim().min(2).max(20),
});

export type SignupInput = z.infer<typeof signupSchema>;
