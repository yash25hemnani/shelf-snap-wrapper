import { getAuth, type UserRecord } from "firebase-admin/auth";
import {
  getFirestore,
  type DocumentData,
  type DocumentSnapshot,
  type Query,
} from "firebase-admin/firestore";
import firebaseApp from "../config/firebase";
import { logAdminAction } from "../services/admin-log.service";
import {
  adminRoute,
  cursorParam,
  param,
  queryText,
  requireBoolean,
} from "../utils/admin-handler";
import { AdminError, fetchPage, nextCursor, runQuery } from "../utils/admin-query";
import { counts, iso, num, str, strList } from "../utils/firestore-values";

interface UserRow {
  uid: string;
  username: string | null;
  name: string | null;
  photoUrl: string | null;
  createdAt: string | null;
  email: string | null;
  disabled: boolean;
  admin: boolean;
  lastSignInAt: string | null;
  totalTokens: number;
  scans: number;
}

interface UserPage {
  users: UserRow[];
  nextCursor: string | null;
}

interface UserLibrary {
  id: string;
  name: string;
  access: string;
  handle: string | null;
  role: "owner" | "editor" | "member";
  bookCount: number;
  memberCount: number;
}

interface UserDetail extends UserRow {
  hasProfile: boolean;
  hasAuth: boolean;
  providers: string[];
  libraries: UserLibrary[];
  usage: {
    requests: number;
    modelCalls: number;
    totalTokens: number;
    routes: Record<string, number>;
    lastUsedAt: string | null;
  } | null;
}

const USER_PAGE_SIZE = 20;

// Same rules as UserModel.validateUsername in the app
const USERNAME_PATTERN = /^[a-z0-9._]{3,20}$/;

const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

function validateUsername(value: string): string | null {
  if (!USERNAME_PATTERN.test(value)) {
    return "Usernames are 3–20 characters: lowercase letters, numbers, . and _";
  }
  if (value.startsWith(".") || value.endsWith(".") || value.includes("..")) {
    return "Usernames can't start or end with a dot, or use two in a row";
  }
  return null;
}

/** Auth records for up to 100 uids; missing accounts are left out. */
async function authRecords(uids: string[]) {
  if (!uids.length) return new Map<string, UserRecord>();
  const result = await auth.getUsers(uids.map((uid) => ({ uid })));
  return new Map(result.users.map((user) => [user.uid, user]));
}

async function authRecord(uid: string) {
  try {
    return await auth.getUser(uid);
  } catch (err) {
    if ((err as { code?: string }).code === "auth/user-not-found") return null;
    throw err;
  }
}

function lastSignIn(record: UserRecord | null | undefined) {
  const time = record?.metadata.lastSignInTime;
  return time ? new Date(time).toISOString() : null;
}

function toRow(
  uid: string,
  profile: DocumentData | undefined,
  record: UserRecord | null | undefined,
  usage: DocumentData | undefined,
): UserRow {
  const routes = counts(usage?.routes);
  return {
    uid,
    username: str(profile?.username),
    name: str(profile?.name),
    photoUrl: str(profile?.photoUrl) ?? record?.photoURL ?? null,
    createdAt:
      iso(profile?.createdAt) ??
      (record ? new Date(record.metadata.creationTime).toISOString() : null),
    email: record?.email ?? null,
    disabled: record?.disabled ?? false,
    admin: record?.customClaims?.admin === true,
    lastSignInAt: lastSignIn(record),
    totalTokens: num(usage?.totalTokens),
    scans: (routes.scan ?? 0) + (routes.discover ?? 0),
  };
}

/**
 * One page of profiles: newest first, or by @username prefix when [search]
 * is given. Emails, status and admin come from Auth for the same uids.
 */
async function listUsers(
  search: string,
  after: string | null,
): Promise<UserPage> {
  const users = db.collection("users");
  const term = search.trim().toLowerCase().replace(/^@/, "");

  //  sorts after every normal character, so this range is "starts with"
  const query: Query = term
    ? users
        .where("username", ">=", term)
        .where("username", "<", `${term}`)
        .orderBy("username")
    : users.orderBy("createdAt", "desc");

  const cursor = after ? await users.doc(after).get() : null;
  const page = await fetchPage(query, USER_PAGE_SIZE, cursor);
  const uids = page.docs.map((doc) => doc.id);

  const [records, usage] = await Promise.all([
    authRecords(uids),
    uids.length
      ? db.getAll(...uids.map((uid) => db.collection("usage").doc(uid)))
      : Promise.resolve([] as DocumentSnapshot[]),
  ]);

  return {
    users: page.docs.map((doc, i) =>
      toRow(doc.id, doc.data(), records.get(doc.id), usage[i]?.data()),
    ),
    nextCursor: nextCursor(page),
  };
}

function roleIn(library: DocumentData, uid: string): UserLibrary["role"] {
  if (library.ownerId === uid) return "owner";
  return strList(library.editors).includes(uid) ? "editor" : "member";
}

async function getUserDetail(uid: string): Promise<UserDetail> {
  const [profile, record, usage, libraries] = await Promise.all([
    db.collection("users").doc(uid).get(),
    authRecord(uid),
    db.collection("usage").doc(uid).get(),
    runQuery(
      db.collection("libraries").where("members", "array-contains", uid),
    ),
  ]);

  if (!profile.exists && !record) {
    throw new AdminError(404, "No user with that id");
  }

  const usageData = usage.data();
  return {
    ...toRow(uid, profile.data(), record, usageData),
    hasProfile: profile.exists,
    hasAuth: record !== null,
    providers: record?.providerData.map((p) => p.providerId) ?? [],
    libraries: libraries.docs
      .map((doc): UserLibrary => {
        const data = doc.data();
        return {
          id: doc.id,
          name: str(data.name) ?? "Untitled",
          access: str(data.access) ?? "private",
          handle: str(data.handle),
          role: roleIn(data, uid),
          bookCount: num(data.bookCount),
          memberCount: strList(data.members).length,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    usage: usageData
      ? {
          requests: num(usageData.requests),
          modelCalls: num(usageData.modelCalls),
          totalTokens: num(usageData.totalTokens),
          routes: counts(usageData.routes),
          lastUsedAt: iso(usageData.lastUsedAt),
        }
      : null,
  };
}

/**
 * Moves the user to a new @username, keeping usernames/{name} reservations
 * unique the same way the app's updateProfile does. Copies of the old name
 * on friendships and join requests stay as they are, as in the app.
 */
async function renameUser(adminUid: string, uid: string, raw: string) {
  const username = raw.trim().toLowerCase().replace(/^@/, "");
  const invalid = validateUsername(username);
  if (invalid) throw new AdminError(400, invalid);

  const userRef = db.collection("users").doc(uid);
  const newRef = db.collection("usernames").doc(username);

  const before = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new AdminError(404, "This user has no profile to rename");
    }
    const old = str(userSnap.get("username"));
    if (old === username) {
      throw new AdminError(400, "That's already their username");
    }

    const oldRef = old ? db.collection("usernames").doc(old) : null;
    const [taken, oldSnap] = await Promise.all([
      tx.get(newRef),
      oldRef ? tx.get(oldRef) : Promise.resolve(null),
    ]);
    if (taken.exists) throw new AdminError(409, `@${username} is already taken`);

    // Only free the old name if it was really theirs
    if (oldRef && oldSnap?.get("uid") === uid) tx.delete(oldRef);
    tx.set(newRef, { uid });
    tx.update(userRef, { username });
    return old;
  });

  await logAdminAction(
    adminUid,
    "user.rename",
    { type: "user", id: uid },
    { username: before },
    { username },
  );
  return { username };
}

/** Empties the display name; the app then shows the @username instead. */
async function clearDisplayName(adminUid: string, uid: string) {
  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) throw new AdminError(404, "This user has no profile");

  const before = str(snap.get("name"));
  if (!before) throw new AdminError(400, "This user has no display name");

  await userRef.update({ name: "" });
  await logAdminAction(
    adminUid,
    "user.clearName",
    { type: "user", id: uid },
    { name: before },
    { name: "" },
  );
}

/**
 * Disabling also revokes refresh tokens, so the app signs them out within
 * the hour and admin calls (checkRevoked) fail straight away.
 */
async function setDisabled(
  adminUid: string,
  uid: string,
  disabled: boolean,
) {
  if (uid === adminUid) {
    throw new AdminError(400, "You can't disable your own account");
  }
  const record = await authRecord(uid);
  if (!record) throw new AdminError(404, "This user has no sign-in account");
  if (record.disabled === disabled) {
    throw new AdminError(400, disabled ? "Already disabled" : "Already enabled");
  }

  await auth.updateUser(uid, { disabled });
  if (disabled) await auth.revokeRefreshTokens(uid);

  await logAdminAction(
    adminUid,
    disabled ? "user.disable" : "user.enable",
    { type: "user", id: uid },
    { disabled: !disabled },
    { disabled },
  );
}

/** Walks every Auth account. Fine at this app's size; used only on revoke. */
async function countAdmins() {
  let total = 0;
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    total += page.users.filter((u) => u.customClaims?.admin === true).length;
    pageToken = page.pageToken;
  } while (pageToken);
  return total;
}

async function setAdmin(adminUid: string, uid: string, admin: boolean) {
  if (!admin && uid === adminUid) {
    throw new AdminError(400, "You can't revoke your own admin access");
  }
  const record = await authRecord(uid);
  if (!record) throw new AdminError(404, "This user has no sign-in account");

  const before = record.customClaims ?? {};
  if ((before.admin === true) === admin) {
    throw new AdminError(400, admin ? "Already an admin" : "Not an admin");
  }
  if (!admin && (await countAdmins()) <= 1) {
    throw new AdminError(409, "This is the last admin, so access can't be revoked");
  }

  // setCustomUserClaims replaces every claim, so keep the others
  const { admin: _dropped, ...rest } = before;
  const after = admin ? { ...before, admin: true } : rest;
  await auth.setCustomUserClaims(uid, after);
  // A revoked admin's current token still carries the claim until it's revoked
  if (!admin) await auth.revokeRefreshTokens(uid);

  await logAdminAction(
    adminUid,
    admin ? "admin.grant" : "admin.revoke",
    { type: "user", id: uid },
    before,
    after,
  );
}

/**
 * Deletes the Auth account, the profile with everything under it (reading
 * logs, ratings, settings) and the @username reservation. Libraries they own
 * and their usage counters stay.
 */
async function deleteUser(adminUid: string, uid: string) {
  if (uid === adminUid) {
    throw new AdminError(400, "You can't delete your own account");
  }
  const userRef = db.collection("users").doc(uid);
  const [record, profile] = await Promise.all([authRecord(uid), userRef.get()]);
  if (!record && !profile.exists) throw new AdminError(404, "No user with that id");
  if (record?.customClaims?.admin === true) {
    throw new AdminError(409, "Revoke their admin access before deleting the account");
  }

  // Auth first, so they can't sign back in while the profile is going
  if (record) await auth.deleteUser(uid);

  const username = str(profile.get("username"));
  if (username) {
    const usernameRef = db.collection("usernames").doc(username);
    const reservation = await usernameRef.get();
    if (reservation.get("uid") === uid) await usernameRef.delete();
  }
  if (profile.exists) await db.recursiveDelete(userRef);

  await logAdminAction(
    adminUid,
    "user.delete",
    { type: "user", id: uid },
    {
      username,
      name: str(profile.get("name")),
      email: record?.email ?? null,
    },
    null,
  );
}

// ---------- Routes ----------

export const getUsers = adminRoute("Failed to load users", async (req) => {
  const search = queryText(req, "q");
  if (search.length > 21) throw new AdminError(400, "Usernames are at most 20 characters");
  return listUsers(search, cursorParam(req));
});

export const getUser = adminRoute("Failed to load the user", (req) =>
  getUserDetail(param(req, "uid")),
);

export const patchUsername = adminRoute("Failed to change the username", (req) => {
  const { username } = req.body ?? {};
  if (typeof username !== "string") throw new AdminError(400, "username is required");
  return renameUser(req.user!.uid, param(req, "uid"), username);
});

export const deleteDisplayName = adminRoute("Failed to clear the display name", (req) =>
  clearDisplayName(req.user!.uid, param(req, "uid")),
);

export const putDisabled = adminRoute("Failed to change the account status", (req) =>
  setDisabled(
    req.user!.uid,
    param(req, "uid"),
    requireBoolean(req.body?.disabled, "disabled"),
  ),
);

export const putAdmin = adminRoute("Failed to change admin access", (req) =>
  setAdmin(req.user!.uid, param(req, "uid"), requireBoolean(req.body?.admin, "admin")),
);

export const removeUser = adminRoute("Failed to delete the account", (req) =>
  deleteUser(req.user!.uid, param(req, "uid")),
);
