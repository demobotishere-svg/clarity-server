import { Router } from "express";
import { handleRazorpayWebhook } from "../controllers/razorpayController";

const router = Router();

router.post("/webhook", handleRazorpayWebhook);

export default router;
