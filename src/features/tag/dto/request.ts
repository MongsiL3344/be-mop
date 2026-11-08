import { z } from "zod";

// 앞뒤 공백 제거 후 1~30자(문자 수 기준, 이모지 1개 = 1자), 제어문자(줄바꿈·탭·NUL 등) 금지
const tagNameSchema = z
  .string()
  .trim()
  .refine((name) => {
    const length = [...name].length;
    return length >= 1 && length <= 30;
  }, "이름은 1자 이상 30자 이하여야 합니다")
  .refine((name) => !/\p{Cc}/u.test(name), "이름에 제어문자를 쓸 수 없습니다");

export const createTagSchema = z.object({
  name: tagNameSchema,
});

export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z.object({
  name: tagNameSchema,
});

export type UpdateTagInput = z.infer<typeof updateTagSchema>;

export const tagIdParamSchema = z.object({
  id: z.uuid(),
});
