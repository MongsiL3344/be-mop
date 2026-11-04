import { Router } from "express";
import { promisify } from "node:util";
import { loginSchema, signupSchema } from "./dto/request.js";
import { login, signup } from "./service.js";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

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
