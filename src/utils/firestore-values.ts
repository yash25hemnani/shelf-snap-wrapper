import type { Timestamp } from "firebase-admin/firestore";

// Readers for loosely typed Firestore fields. Docs written by older app
// versions can miss fields or hold the wrong type, so nothing is trusted.

export function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A whole number, or [fallback] when the field is missing or not a number. */
export function int(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

export function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function strList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

export function counts(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, n]) => [key, num(n)]),
  );
}

export function iso(value: unknown) {
  return value && typeof (value as Timestamp).toDate === "function"
    ? (value as Timestamp).toDate().toISOString()
    : null;
}
