import { Router } from "express";
import { requireLogin } from "../../lib/auth.js";
import { createProjectSchema, projectIdParamSchema } from "./dto/request.js";
import { createProject, getProject } from "./service.js";

export const projectRouter = Router();

projectRouter.post("/", requireLogin, async (req, res) => {
  res.status(201).json(await createProject(req.userId, createProjectSchema.parse(req.body)));
});

projectRouter.get("/:id", requireLogin, async (req, res) => {
  const { id } = projectIdParamSchema.parse(req.params);
  res.json(await getProject(req.userId, id));
});
