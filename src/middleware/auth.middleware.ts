import { Request, Response, NextFunction } from "express";
import { getAuth } from "firebase-admin/auth";
import firebaseApp from "../config/firebase";
import { logger } from "../utils/logger";

const auth = getAuth(firebaseApp);

export async function verifyFirebaseToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    req.user = await auth.verifyIdToken(authHeader.slice("Bearer ".length));
    next();
  } catch (err) {
    logger.warn({ err }, "Firebase ID token verification failed");
    res.status(401).json({ error: "Unauthorized" });
  }
}
