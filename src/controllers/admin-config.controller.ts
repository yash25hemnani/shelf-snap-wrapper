import { FieldValue, getFirestore, type DocumentData } from "firebase-admin/firestore";
import firebaseApp from "../config/firebase";
import { logAdminAction } from "../services/admin-log.service";
import { adminRoute, httpsUrl } from "../utils/admin-handler";
import { AdminError } from "../utils/admin-query";
import { iso, str } from "../utils/firestore-values";

interface Announcement {
  text: string;
  active: boolean;
  link: string | null;
}

/** config/app: what the app reads for the update card and the banner. */
interface AppConfig {
  latestVersion: string | null;
  latestBuild: number | null;
  minBuild: number | null;
  driveLink: string | null;
  announcement: Announcement;
}

interface AppConfigView extends AppConfig {
  updatedAt: string | null;
  updatedBy: string | null;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const ANNOUNCEMENT_MAX = 280;

const db = getFirestore(firebaseApp);
const configRef = db.collection("config").doc("app");

function build(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function toConfig(data: DocumentData | undefined): AppConfig {
  const announcement = (data?.announcement ?? {}) as DocumentData;
  return {
    latestVersion: str(data?.latestVersion),
    latestBuild: build(data?.latestBuild),
    minBuild: build(data?.minBuild),
    driveLink: str(data?.driveLink),
    announcement: {
      text: str(announcement.text) ?? "",
      active: announcement.active === true,
      link: str(announcement.link),
    },
  };
}

async function getConfig(): Promise<AppConfigView> {
  const data = (await configRef.get()).data();
  return {
    ...toConfig(data),
    updatedAt: iso(data?.updatedAt),
    updatedBy: str(data?.updatedBy),
  };
}

function parseBuild(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
    throw new AdminError(400, `${label} must be a whole number above 0`);
  }
  return n;
}

function parseConfig(body: unknown): AppConfig {
  const input = (body ?? {}) as Record<string, unknown>;
  const announcement = (input.announcement ?? {}) as Record<string, unknown>;

  const latestVersion = typeof input.latestVersion === "string"
    ? input.latestVersion.trim() || null
    : null;
  if (latestVersion && !VERSION_PATTERN.test(latestVersion)) {
    throw new AdminError(400, "Version must look like 1.4.0");
  }

  const latestBuild = parseBuild(input.latestBuild, "Latest build");
  const minBuild = parseBuild(input.minBuild, "Minimum build");
  if (minBuild && !latestBuild) {
    throw new AdminError(400, "Set the latest build before a minimum build");
  }
  if (minBuild && latestBuild && minBuild > latestBuild) {
    throw new AdminError(400, "The minimum build can't be above the latest build");
  }

  const driveLink = httpsUrl(input.driveLink, "Download link");
  if (latestBuild && !driveLink) {
    throw new AdminError(400, "Add the download link, so the update card has somewhere to go");
  }

  const text = typeof announcement.text === "string" ? announcement.text.trim() : "";
  if (text.length > ANNOUNCEMENT_MAX) {
    throw new AdminError(400, `Keep the announcement under ${ANNOUNCEMENT_MAX} characters`);
  }
  const active = announcement.active === true;
  if (active && !text) throw new AdminError(400, "Write the announcement before showing it");

  return {
    latestVersion,
    latestBuild,
    minBuild,
    driveLink,
    announcement: { text, active, link: httpsUrl(announcement.link, "Announcement link") },
  };
}

async function saveConfig(adminUid: string, next: AppConfig) {
  const before = toConfig((await configRef.get()).data());
  await configRef.set({
    ...next,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: adminUid,
  });
  await logAdminAction(adminUid, "config.update", { type: "config", id: "app" }, before, next);
  return getConfig();
}

// ---------- Routes ----------

export const getAppConfig = adminRoute("Failed to load the app config", () => getConfig());

export const putAppConfig = adminRoute("Failed to save the app config", (req) =>
  saveConfig(req.user!.uid, parseConfig(req.body)),
);
