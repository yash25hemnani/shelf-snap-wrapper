import { FieldValue, getFirestore } from "firebase-admin/firestore";
import firebaseApp from "../config/firebase";
import { logger } from "../utils/logger";

export interface AdminLogTarget {
  type:
    | "user"
    | "library"
    | "book"
    | "loan"
    | "friendship"
    | "review"
    | "config";
  id: string;
}

const db = getFirestore(firebaseApp);

// Records one admin action in adminLog. A failed log write is logged,
// and not thrown, so an action that already happened isn't reported as failed.
export async function logAdminAction(
  adminUid: string,
  action: string,
  target: AdminLogTarget,
  before: unknown = null,
  after: unknown = null,
) {
  try {
    await db.collection("adminLog").add({
      adminUid,
      action,
      target,
      before,
      after,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    logger.error({
        error,
        adminUid,
        action,
        target
    }, "admin write failed");
  }
}
