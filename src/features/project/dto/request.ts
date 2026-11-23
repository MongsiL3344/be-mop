import { z } from "zod";

// 앞뒤 공백 제거 후 1~50자(문자 수 기준, 이모지 1개 = 1자), 제어문자(줄바꿈·탭·NUL 등) 금지
const nameSchema = z
  .string()
  .trim()
  .refine((name) => {
    const length = [...name].length;
    return length >= 1 && length <= 50;
  }, "이름은 1자 이상 50자 이하여야 합니다")
  .refine((name) => !/\p{Cc}/u.test(name), "이름에 제어문자를 쓸 수 없습니다");

// 앞뒤 공백 제거 후 2000자(문자 수 기준) 이하, 줄바꿈·탭 외 제어문자 금지. 생략·null·빈 문자열은 소개 없음(null)
const descriptionSchema = z
  .string()
  .trim()
  .refine((description) => [...description].length <= 2000, "소개는 2000자 이하여야 합니다")
  .refine((description) => !/[^\P{Cc}\n\t]/u.test(description), "소개에 줄바꿈·탭 외 제어문자를 쓸 수 없습니다")
  .nullish()
  .transform((description) => description || null);

// 생략하면 빈 목록, null은 거부. 같은 id 중복 금지
const techStackIdsSchema = z
  .array(z.uuid())
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, "같은 기술 스택을 두 번 고를 수 없습니다")
  .default([]);

// 생략하면 빈 목록, null은 거부. 한 프로젝트 안에서 마스터 포지션은 고유(정원이 달라도 중복 금지)
const positionsSchema = z
  .array(
    z.object({
      positionId: z.uuid(),
      capacity: z.number().int().min(1).max(20),
    }),
  )
  .max(10)
  .refine(
    (positions) => new Set(positions.map((p) => p.positionId)).size === positions.length,
    "같은 포지션을 두 번 고를 수 없습니다",
  )
  .default([]);

export const createProjectSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
  duration: z.number().int().min(1).max(36),
  meetingType: z.enum(["OFFLINE", "ONLINE"]),
  purpose: z.enum(["CONTEST", "PORTFOLIO", "STARTUP"]),
  techStackIds: techStackIdsSchema,
  positions: positionsSchema,
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const projectIdParamSchema = z.object({
  id: z.uuid(),
});
