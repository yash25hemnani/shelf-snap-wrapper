import type { Request, Response } from "express";
import { AdminError, IndexNeededError } from "./admin-query";
import { logger } from "./logger";

/**
 * Wraps an admin route. Whatever [run] returns is sent as JSON ({ ok: true }
 * when nothing). AdminError keeps its status and message, a missing index
 * becomes a 409 with the console link, and anything else is logged and sent
 * as a 500 with [failure] as the message.
 */
export function adminRoute(
  failure: string,
  run: (req: Request, res: Response) => Promise<unknown>,
) {
  return async (req: Request, res: Response) => {
    try {
      const result = await run(req, res);
      if (!res.headersSent) res.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof AdminError) {
        res.status(err.status).json({ error: err.message });
      } else if (err instanceof IndexNeededError) {
        res.status(409).json({ error: err.message, createIndexUrl: err.createUrl });
      } else {
        logger.error({ err, path: req.path }, failure);
        res.status(500).json({ error: failure });
      }
    }
  };
}

/** A query string value, or "" when it's missing or repeated. */
export function queryText(req: Request, name: string) {
  const value = req.query[name];
  return typeof value === "string" ? value.trim() : "";
}

/** The `after` cursor: a doc id, so no slashes. */
export function cursorParam(req: Request) {
  const after = queryText(req, "after");
  if (after.includes("/")) throw new AdminError(400, "Invalid cursor");
  return after || null;
}

/** [value] when it's one of [allowed], null when empty, else a 400. */
export function filterParam(value: string, allowed: readonly string[], label: string) {
  if (!value) return null;
  if (!allowed.includes(value)) throw new AdminError(400, `Unknown ${label} filter`);
  return value;
}

export function requireBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new AdminError(400, `${label} must be true or false`);
  return value;
}

/** Trimmed text up to [max] characters, or null when it's missing or empty. */
export function optionalText(value: unknown, max: number, label: string) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new AdminError(400, `${label} must be text`);
  const text = value.trim();
  if (text.length > max) throw new AdminError(400, `${label} must be under ${max} characters`);
  return text || null;
}

/** An https:// link, or null when empty. */
export function httpsUrl(value: unknown, label: string) {
  const text = optionalText(value, 2000, label);
  if (!text) return null;
  try {
    if (new URL(text).protocol === "https:") return text;
  } catch {
    // falls through to the error below
  }
  throw new AdminError(400, `${label} must be an https:// link`);
}

/** A route param as a string; Express 5 types params loosely. */
export function param(req: Request, name: string) {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
}
