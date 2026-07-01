import { Router } from "express";
import { queueBulkMessages } from "../controllers/bulkController";
import { requireAuth } from "../middlewares/authMiddleware";

const router = Router();

router.post("/queue", requireAuth, queueBulkMessages);

export default router;
