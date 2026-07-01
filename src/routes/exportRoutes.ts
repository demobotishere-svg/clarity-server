import { Router } from "express";
import { exportLeads } from "../controllers/exportController";
import { requireAuth } from "../middlewares/authMiddleware";

const router = Router();

router.get("/leads", requireAuth, exportLeads);

export default router;
