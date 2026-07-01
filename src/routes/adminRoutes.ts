import { Router } from "express";
import { setupAdmin } from "../controllers/adminController";
import { requireAuth } from "../middlewares/authMiddleware";

const router = Router();

router.post("/setup", requireAuth, setupAdmin);

export default router;
