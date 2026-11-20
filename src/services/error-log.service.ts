import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import firebaseApp from "../config/firebase";
import { logger } from "../utils/logger";
import type { UsageRoute } from "./usage.service";

export type ErrorKind =
  | "models_unavailable" // Groq and Gemini both out (503)
  | "model_failed" // other model errors (502)
  | "malformed_json" // model reply wasn't JSON
  | "no_books_array" // JSON without a books array
  | "empty_identification" // model found no spines (still a 200)
  | "lookup_failed" // Google Books lookups that threw during a scan
  | "throttled" // Open Library 429, returned as 503
  | "upstream_failed"; // Open Library unreachable (502)

export interface ErrorEntry {
  route: UsageRoute;
  kind: ErrorKind;
  status: number;
  message: string;
  uid?: string;
  provider?: "groq" | "gemini";
  details?: Record<string, unknown>;
}

// Firestore's TTL policy on errorLog.expiresAt deletes entries after this.
// TTL has to be turned on once in the console (see the plan).
const ERROR_TTL_DAYS = 30;

const db = getFirestore(firebaseApp);

function describe(err: unknown) {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}

/** Writes one failure to errorLog. Never throws. */
export async function logError(entry: ErrorEntry, err?: unknown) {
  const message = (err === undefined ? entry.message : `${entry.message}: ${describe(err)}`)
    .slice(0, 500);

  try {
    await db.collection("errorLog").add({
      route: entry.route,
      kind: entry.kind,
      status: entry.status,
      message,
      uid: entry.uid ?? null,
      provider: entry.provider ?? null,
      details: entry.details ?? null,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(
        Date.now() + ERROR_TTL_DAYS * 24 * 60 * 60 * 1000,
      ),
    });
  } catch (writeErr) {
    logger.error({ err: writeErr, entry }, "Error log write failed");
  }
}
