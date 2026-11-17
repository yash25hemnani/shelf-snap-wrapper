import { Router } from "express";
import { requireAdmin } from "../middleware/admin.middleware";
import { getMe } from "../controllers/admin.controller";

const router = Router();

router.use(requireAdmin);

router.get("/me", getMe);

export default router;