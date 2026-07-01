import { Router } from "express";
import { verifyWebhook, handleWebhook } from "../controllers/whatsappController";
import { verifyWhatsAppSignature } from "../middlewares/whatsappAuth";

const router = Router();

router.get("/webhook", verifyWebhook);
router.post("/webhook", verifyWhatsAppSignature, handleWebhook);

export default router;
