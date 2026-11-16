import { Router } from "express";
import { requireLogin } from "../../lib/auth.js";
import { createProjectSchema } from "./dto/request.js";
import { createProject } from "./service.js";

export const projectRouter = Router();

projectRouter.post("/", requireLogin, async (req, res) => {
  res.status(201).json(await createProject(req.userId, createProjectSchema.parse(req.body)));
});
