import { Router } from "express";
import { getCatalogPage } from "../controllers/catalog.controller";

// Public pages, no Firebase token. Mounted before the books router, whose
// token check would otherwise run for every path.
const router = Router();

router.get("/lib/:handle", getCatalogPage);

export default router;
