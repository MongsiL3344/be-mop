import { Router } from "express";
import { signupSchema } from "./dto/request.js";
import { signup } from "./service.js";

export const userRouter = Router();

userRouter.post("/signup", async (req, res) => {
  await signup(signupSchema.parse(req.body));
  res.status(201).end();
});
