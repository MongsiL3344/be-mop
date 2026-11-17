import { Router } from "express";
import { promisify } from "node:util";
import { requireLogin } from "../../lib/auth.js";
import { loginSchema, signupSchema, updateProfileSchema, userIdParamSchema } from "./dto/request.js";
import { getProfile, login, me, signup, updateProfile } from "./service.js";

export const userRouter = Router();

userRouter.post("/signup", async (req, res) => {
  await signup(signupSchema.parse(req.body));
  res.status(201).end();
});

userRouter.post("/login", async (req, res) => {
  const user = await login(loginSchema.parse(req.body));
  await promisify(req.session.regenerate.bind(req.session))();
  req.session.userId = user.id;
  res.json(user);
});

userRouter.post("/logout", async (req, res) => {
  await promisify(req.session.destroy.bind(req.session))();
  res.clearCookie("sid").status(204).end();
});

userRouter.get("/me", requireLogin, async (req, res) => {
  res.json(await me(req.userId));
});

// 내 프로필 수정. 보낸 필드만 바뀌고 응답은 GET /users/:id와 같은 형태
userRouter.patch("/me", requireLogin, async (req, res) => {
  const input = updateProfileSchema.parse(req.body);
  res.json(await updateProfile(req.userId, input));
});

// GET /me보다 아래에 둬야 "me"가 :id로 잡히지 않는다
userRouter.get("/:id", async (req, res) => {
  const { id } = userIdParamSchema.parse(req.params);
  res.json(await getProfile(id));
});
