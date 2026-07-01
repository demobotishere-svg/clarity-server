import { Router } from "express";
import { login, register, logout, resetPassword } from "../controllers/authController";
import { authLimiter } from "../middlewares/rateLimiter";

const router = Router();

router.post("/login", authLimiter, login);
router.post("/register", authLimiter, register);
router.post("/logout", logout);
router.post("/reset-password", authLimiter, resetPassword);

export default router;
