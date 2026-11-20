import { FieldValue, getFirestore } from "firebase-admin/firestore";
import firebaseApp from "../config/firebase";
import { logger } from "../utils/logger";
import type { TokenUsage } from "./vision.service";

// scan = /identify-books, discover = /discover (both call a model),
// search = /search-books, isbn = /isbn-search
export type UsageRoute = "scan" | "discover" | "search" | "isbn";

export interface ModelCall {
  provider: "groq" | "gemini";
  usage: TokenUsage;
}

const db = getFirestore(firebaseApp);

// UTC day, so every server instance agrees on which doc a request lands in
export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// The counters both docs share. Nested maps (not "routes.scan" dotted keys),
// because set() with merge treats a dotted key as a literal field name.
function increments(route: UsageRoute, model?: ModelCall) {
  const one = FieldValue.increment(1);
  return {
    requests: one,
    routes: { [route]: one },
    ...(model && {
      modelCalls: one,
      promptTokens: FieldValue.increment(model.usage.promptTokens),
      completionTokens: FieldValue.increment(model.usage.completionTokens),
      totalTokens: FieldValue.increment(model.usage.totalTokens),
      providers: { [model.provider]: one },
    }),
  };
}

/**
 * Adds one request to usage/{uid} and usageDaily/{yyyy-mm-dd} in a single
 * batch. Pass [model] for routes that called a vision model so its tokens
 * count too. Never throws: a failed write is logged and the request carries on.
 * Awaited before the response goes out, since Vercel can freeze the function
 * as soon as the response is sent.
 */
export async function recordUsage(
  uid: string | undefined,
  route: UsageRoute,
  model?: ModelCall,
) {
  if (!uid) return;

  const day = dayKey();
  const batch = db.batch();
  batch.set(
    db.collection("usage").doc(uid),
    { ...increments(route, model), lastUsedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  batch.set(
    db.collection("usageDaily").doc(day),
    { ...increments(route, model), date: day },
    { merge: true },
  );

  try {
    await batch.commit();
  } catch (err) {
    logger.error({ err, uid, route }, "Usage write failed");
  }
}
