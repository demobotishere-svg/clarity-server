import { Router } from "express";
import { verifyWebhook, handleWebhook } from "../controllers/whatsappController";

const router = Router();

router.get("/webhook", verifyWebhook);
router.post("/webhook", handleWebhook);

export default router;
