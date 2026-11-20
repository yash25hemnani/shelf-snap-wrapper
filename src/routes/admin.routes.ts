import { Router } from "express";
import { requireAdmin } from "../middleware/admin.middleware";
import {
  getAuditLog,
  getErrors,
  getMe,
  getStats,
  getTokens,
  getUsageDaily,
} from "../controllers/admin.controller";
import {
  deleteDisplayName,
  getUser,
  getUsers,
  patchUsername,
  putAdmin,
  putDisabled,
  removeUser,
} from "../controllers/admin-users.controller";
import {
  getFriendships,
  getLibraries,
  getLibraryBooks,
  getLibraryDetail,
  getLoans,
  getReports,
  getReviews,
  patchBook,
  postLoanResolve,
  putLibraryLock,
  removeBook,
  removeFriendship,
  removeReport,
  removeReviewText,
} from "../controllers/admin-content.controller";
import { getAppConfig, putAppConfig } from "../controllers/admin-config.controller";

const router = Router();

router.use(requireAdmin);

router.get("/me", getMe);
router.get("/stats", getStats);
router.get("/usage/daily", getUsageDaily);
router.get("/usage/tokens", getTokens);
router.get("/errors", getErrors);
router.get("/audit", getAuditLog);

router.get("/users", getUsers);
router.get("/users/:uid", getUser);
router.patch("/users/:uid/username", patchUsername);
router.delete("/users/:uid/name", deleteDisplayName);
router.put("/users/:uid/disabled", putDisabled);
router.put("/users/:uid/admin", putAdmin);
router.delete("/users/:uid", removeUser);

router.get("/libraries", getLibraries);
router.get("/libraries/:id", getLibraryDetail);
router.put("/libraries/:id/lock", putLibraryLock);
router.get("/libraries/:id/books", getLibraryBooks);
router.patch("/libraries/:id/books/:bookId", patchBook);
router.delete("/libraries/:id/books/:bookId", removeBook);

router.get("/loans", getLoans);
router.post("/loans/:id/resolve", postLoanResolve);

router.get("/friendships", getFriendships);
router.delete("/friendships/:id", removeFriendship);

router.get("/reports", getReports);
router.delete("/reports/:id", removeReport);

router.get("/reviews", getReviews);
router.post("/reviews/remove", removeReviewText);

router.get("/config", getAppConfig);
router.put("/config", putAppConfig);

export default router;
