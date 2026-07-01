import { Router } from "express";
import { processQueue } from "../controllers/cronController";
import { requireCronAuth } from "../middlewares/authMiddleware";

const router = Router();

router.get("/process-queue", requireCronAuth, processQueue);

export default router;
