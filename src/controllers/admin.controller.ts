import type { Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";
import {
  AggregateField,
  getFirestore,
  type DocumentData,
  type Query,
} from "firebase-admin/firestore";
import firebaseApp from "../config/firebase";
import { dayKey } from "../services/usage.service";
import {
  adminRoute,
  cursorParam,
  filterParam,
  queryText,
} from "../utils/admin-handler";
import { AdminError, fetchPage, nextCursor } from "../utils/admin-query";
import { counts, iso, num, str } from "../utils/firestore-values";

interface Totals {
  users: number;
  libraries: { total: number; public: number; unlisted: number; private: number };
  books: number;
  loans: number;
  friendships: number;
}

interface DailyUsage {
  date: string;
  requests: number;
  modelCalls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  routes: Record<string, number>;
  providers: Record<string, number>;
}

interface TopUser {
  uid: string;
  username: string | null;
  name: string | null;
  totalTokens: number;
  modelCalls: number;
  requests: number;
  lastUsedAt: string | null;
}

interface TokenSummary {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  modelCalls: number;
  trackedUsers: number;
  avgPerUser: number;
  avgPerScan: number;
  topUsers: TopUser[];
}

interface ErrorEntryView {
  id: string;
  route: string;
  kind: string;
  status: number;
  message: string;
  uid: string | null;
  provider: string | null;
  details: unknown;
  createdAt: string | null;
}

interface ErrorPage {
  errors: ErrorEntryView[];
  nextCursor: string | null;
}

interface AdminLogEntry {
  id: string;
  adminUid: string;
  adminEmail: string | null;
  action: string;
  target: { type: string; id: string };
  before: unknown;
  after: unknown;
  createdAt: string | null;
}

const ERROR_ROUTES = ["scan", "discover", "search", "isbn"] as const;
const ERROR_PAGE_SIZE = 20;
const MAX_TREND_DAYS = 90;
const AUDIT_TARGET_TYPES = [
  "user",
  "library",
  "book",
  "loan",
  "friendship",
  "review",
  "config",
] as const;
const AUDIT_PAGE_SIZE = 25;

const db = getFirestore(firebaseApp);

async function countOf(query: Query) {
  const snap = await query.count().get();
  return snap.data().count;
}

// count() queries cost about one read per 1,000 docs, so no counter docs
async function getTotals(): Promise<Totals> {
  const libraries = db.collection("libraries");
  const [users, total, pub, unlisted, priv, books, loans, friendships] =
    await Promise.all([
      countOf(db.collection("users")),
      countOf(libraries),
      countOf(libraries.where("access", "==", "public")),
      countOf(libraries.where("access", "==", "unlisted")),
      countOf(libraries.where("access", "==", "private")),
      // Books live in libraries/{id}/books
      countOf(db.collectionGroup("books")),
      countOf(db.collection("loans")),
      countOf(db.collection("friendships")),
    ]);

  return {
    users,
    libraries: { total, public: pub, unlisted, private: priv },
    books,
    loans,
    friendships,
  };
}

function toDailyUsage(date: string, data: DocumentData | undefined): DailyUsage {
  return {
    date,
    requests: num(data?.requests),
    modelCalls: num(data?.modelCalls),
    totalTokens: num(data?.totalTokens),
    promptTokens: num(data?.promptTokens),
    completionTokens: num(data?.completionTokens),
    routes: counts(data?.routes),
    providers: counts(data?.providers),
  };
}

/** The last [days] days of usageDaily, oldest first, with empty days as 0. */
async function getDailyUsage(days: number): Promise<DailyUsage[]> {
  const today = Date.now();
  const dates = Array.from({ length: days }, (_, i) =>
    dayKey(new Date(today - (days - 1 - i) * 24 * 60 * 60 * 1000)),
  );
  const snaps = await db.getAll(
    ...dates.map((date) => db.collection("usageDaily").doc(date)),
  );
  return snaps.map((snap, i) => toDailyUsage(dates[i], snap.data()));
}

// Averages are worked out here from sums, never stored
async function getTokenSummary(): Promise<TokenSummary> {
  const usage = db.collection("usage");
  // One sum per query: summing several fields in one aggregate needs a
  // composite index over all of them, a single field doesn't
  const sumOf = async (field: string) =>
    num((await usage.aggregate({ sum: AggregateField.sum(field) }).get()).data().sum);

  const [trackedUsers, totalTokens, promptTokens, completionTokens, modelCalls, top] =
    await Promise.all([
      countOf(usage),
      sumOf("totalTokens"),
      sumOf("promptTokens"),
      sumOf("completionTokens"),
      sumOf("modelCalls"),
      usage.orderBy("totalTokens", "desc").limit(10).get(),
    ]);

  // Profiles for the top users' @username and name
  const profiles = top.empty
    ? []
    : await db.getAll(...top.docs.map((doc) => db.collection("users").doc(doc.id)));

  const topUsers = top.docs.map((doc, i): TopUser => {
    const data = doc.data();
    const profile = profiles[i]?.data();
    return {
      uid: doc.id,
      username: str(profile?.username),
      name: str(profile?.name),
      totalTokens: num(data.totalTokens),
      modelCalls: num(data.modelCalls),
      requests: num(data.requests),
      lastUsedAt: iso(data.lastUsedAt),
    };
  });

  return {
    totalTokens,
    promptTokens,
    completionTokens,
    modelCalls,
    trackedUsers,
    avgPerUser: trackedUsers ? Math.round(totalTokens / trackedUsers) : 0,
    avgPerScan: modelCalls ? Math.round(totalTokens / modelCalls) : 0,
    topUsers,
  };
}

function toErrorView(id: string, data: DocumentData): ErrorEntryView {
  return {
    id,
    route: str(data.route) ?? "unknown",
    kind: str(data.kind) ?? "unknown",
    status: num(data.status),
    message: str(data.message) ?? "",
    uid: str(data.uid),
    provider: str(data.provider),
    details: data.details ?? null,
    createdAt: iso(data.createdAt),
  };
}

/**
 * One page of errorLog, newest first, optionally for one route. Filtering by
 * route needs a composite index (route asc, createdAt desc); until it exists
 * Firestore fails with a link to create it, passed on as IndexNeededError.
 */
async function listErrors(
  route: string | null,
  after: string | null,
): Promise<ErrorPage> {
  const errorLog = db.collection("errorLog");
  let query: Query = errorLog;
  if (route) query = query.where("route", "==", route);
  query = query.orderBy("createdAt", "desc");

  const cursor = after ? await errorLog.doc(after).get() : null;
  const page = await fetchPage(query, ERROR_PAGE_SIZE, cursor);
  return {
    errors: page.docs.map((doc) => toErrorView(doc.id, doc.data())),
    nextCursor: nextCursor(page),
  };
}

/**
 * One page of adminLog, newest first. Filtering by target type needs the
 * (target.type, createdAt) index. Admin emails come from Auth.
 */
async function listAdminLog(type: string | null, after: string | null) {
  const adminLog = db.collection("adminLog");
  let query: Query = adminLog;
  if (type) query = query.where("target.type", "==", type);
  query = query.orderBy("createdAt", "desc");

  const cursor = after ? await adminLog.doc(after).get() : null;
  const page = await fetchPage(query, AUDIT_PAGE_SIZE, cursor);

  // "script" is the grant-admin script, not an account
  const uids = [...new Set(page.docs.map((d) => str(d.get("adminUid")) ?? ""))]
    .filter((uid) => uid && uid !== "script");
  const emails = new Map<string, string | null>();
  if (uids.length) {
    const result = await getAuth(firebaseApp).getUsers(uids.map((uid) => ({ uid })));
    result.users.forEach((u) => emails.set(u.uid, u.email ?? null));
  }

  return {
    entries: page.docs.map((doc): AdminLogEntry => {
      const data = doc.data();
      const adminUid = str(data.adminUid) ?? "";
      return {
        id: doc.id,
        adminUid,
        adminEmail: emails.get(adminUid) ?? null,
        action: str(data.action) ?? "unknown",
        target: {
          type: str(data.target?.type) ?? "unknown",
          id: str(data.target?.id) ?? "",
        },
        before: data.before ?? null,
        after: data.after ?? null,
        createdAt: iso(data.createdAt),
      };
    }),
    nextCursor: nextCursor(page),
  };
}

// ---------- Routes ----------

export function getMe(req: Request, res: Response) {
  const user = req.user!;
  res.json({
    uid: user.uid,
    email: user.email ?? null,
    name: user.name ?? null,
    admin: user.admin === true,
    authTime: user.auth_time,
  });
}

export const getStats = adminRoute("Failed to load totals", () => getTotals());

export const getUsageDaily = adminRoute("Failed to load usage", async (req) => {
  const raw = queryText(req, "days") || "30";
  const days = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_TREND_DAYS) {
    throw new AdminError(400, `days must be between 1 and ${MAX_TREND_DAYS}`);
  }
  return { days: await getDailyUsage(days) };
});

export const getTokens = adminRoute("Failed to load token usage", () => getTokenSummary());

export const getErrors = adminRoute("Failed to load the error log", (req) =>
  listErrors(
    filterParam(queryText(req, "route"), ERROR_ROUTES, "route"),
    cursorParam(req),
  ),
);

export const getAuditLog = adminRoute("Failed to load the audit log", (req) =>
  listAdminLog(
    filterParam(queryText(req, "type"), AUDIT_TARGET_TYPES, "type"),
    cursorParam(req),
  ),
);
