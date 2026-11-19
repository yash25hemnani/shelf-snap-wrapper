import { getAuth } from "firebase-admin/auth";
import firebaseApp from "../config/firebase";
import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

const auth = getAuth(firebaseApp);

// 401 = missing or invalid token, 403 = valid token without the admin claim.
// checkRevoked rejects tokens of disabled users and revoked sessions straight
// away, instead of waiting up to an hour for the token to expire.
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  try {
    const decoded = await auth.verifyIdToken(
      authHeader.slice("Bearer ".length),
      true,
    );

    if (decoded.admin !== true) {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.user = decoded;
    next();
  } catch (error) {
    logger.warn({error}, "Admin token verification failed");
    res.status(401).json({error: "Unauthorized"});
  }
}
