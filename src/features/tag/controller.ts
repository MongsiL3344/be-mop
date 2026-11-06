import { Router } from "express";
import { requireAdmin } from "../../lib/auth.js";
import { createTagSchema } from "./dto/request.js";
import { createPosition, createTechStack } from "./service.js";

export const tagRouter = Router();

tagRouter.post("/tech-stacks", requireAdmin, async (req, res) => {
  res.status(201).json(await createTechStack(createTagSchema.parse(req.body)));
});

tagRouter.post("/positions", requireAdmin, async (req, res) => {
  res.status(201).json(await createPosition(createTagSchema.parse(req.body)));
});
