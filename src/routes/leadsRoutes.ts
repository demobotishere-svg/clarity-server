import { Router } from "express";
import { createLead } from "../controllers/leadsController";
import { leadsLimiter } from "../middlewares/rateLimiter";

const router = Router();

router.post("/", leadsLimiter, createLead);

export default router;
