import { Router } from "express";
import { promisify } from "node:util";
import { requireLogin } from "../../lib/auth.js";
import { loginSchema, signupSchema } from "./dto/request.js";
import { login, me, signup } from "./service.js";

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
