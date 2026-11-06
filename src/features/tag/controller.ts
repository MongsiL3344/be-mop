import { Router } from "express";
import { requireAdmin } from "../../lib/auth.js";
import { createTagSchema, tagIdParamSchema, updateTagSchema } from "./dto/request.js";
import {
  createPosition,
  createTechStack,
  listPositions,
  listTechStacks,
  updatePosition,
  updateTechStack,
} from "./service.js";

export const tagRouter = Router();

tagRouter.get("/tech-stacks", async (_req, res) => {
  res.json(await listTechStacks());
});

tagRouter.get("/positions", async (_req, res) => {
  res.json(await listPositions());
});

tagRouter.post("/tech-stacks", requireAdmin, async (req, res) => {
  res.status(201).json(await createTechStack(createTagSchema.parse(req.body)));
});

tagRouter.post("/positions", requireAdmin, async (req, res) => {
  res.status(201).json(await createPosition(createTagSchema.parse(req.body)));
});

tagRouter.patch("/tech-stacks/:id", requireAdmin, async (req, res) => {
  const { id } = tagIdParamSchema.parse(req.params);
  res.json(await updateTechStack(id, updateTagSchema.parse(req.body)));
});

tagRouter.patch("/positions/:id", requireAdmin, async (req, res) => {
  const { id } = tagIdParamSchema.parse(req.params);
  res.json(await updatePosition(id, updateTagSchema.parse(req.body)));
});
