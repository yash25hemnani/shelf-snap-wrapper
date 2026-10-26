import { logger } from "../utils/logger";
import { Book } from "../types/books.types";
import { toIsbn13 } from "../utils/isbn";

interface GoogleBooksItem {
  id?: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    industryIdentifiers?: { type: string; identifier: string }[];
    imageLinks?: { thumbnail?: string };
    description?: string;
    publishedDate?: string;
    pageCount?: number;
    categories?: string[];
    language?: string;
  };
}

const BASE_URL = "https://www.googleapis.com/books/v1/volumes";
const RETRY_DELAY_MS = 1000;

const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY;

if (!GOOGLE_BOOKS_API_KEY) {
  logger.error("Missing GOOGLE_BOOKS_API_KEY in .env — refusing to start.");
  process.exit(1);
}

/** Google descriptions can carry <p>, <b>, <br> and entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseItem(item: GoogleBooksItem): Book {
  const info = item.volumeInfo ?? {};
  const identifiers = info.industryIdentifiers ?? [];
  const isbn =
    identifiers.find((id) => id.type === "ISBN_13")?.identifier ??
    identifiers.find((id) => id.type === "ISBN_10")?.identifier;

  return {
    googleBooksId: item.id ?? null,
    workId: null,
    isbn: isbn ? toIsbn13(isbn) : null,
    title: info.title ?? "Unknown Title",
    subtitle: info.subtitle ?? null,
    authors: info.authors ?? [],
    description: info.description ? stripHtml(info.description) : null,
    categories: info.categories ?? [],
    publisher: info.publisher ?? null,
    publishedDate: info.publishedDate ?? null,
    pageCount: info.pageCount ?? null,
    language: info.language ?? null, // already ISO 639-1
    // Google serves http:// thumbnails; Android blocks cleartext by default.
    coverUrl: info.imageLinks?.thumbnail?.replace(/^http:/, "https:") ?? null,
    source: "google",
  };
}

/**
 * One Google Books request; transient failures (429 / 5xx) retry once.
 * [quotaUser] makes Google count requests per app user instead of per
 * server IP, which Vercel shares with many other apps.
 */
async function querySingle(query: string, quotaUser?: string): Promise<Book[]> {
  const params = new URLSearchParams({ q: query, key: GOOGLE_BOOKS_API_KEY! });
  if (quotaUser) params.set("quotaUser", quotaUser);
  const url = `${BASE_URL}?${params}`;
  const start = Date.now();

  let response = await fetch(url);
  // 429 (rate limited) and 5xx are usually transient; parallel lookups make
  // 429s likely, and retrying keeps a real book from being dropped.
  if (response.status === 429 || response.status >= 500) {
    logger.warn({ query, status: response.status }, "Google Books retry");
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await fetch(url);
  }

  if (!response.ok) {
    // Google's JSON error says why (quota, key restriction, bad request)
    const body = await response.text().catch(() => "");
    logger.error(
      {
        query,
        status: response.status,
        durationMs: Date.now() - start,
        body: body.slice(0, 300),
      },
      "Google Books request failed",
    );
    throw new Error(`Google Books API error: ${response.status}`);
  }

  const data = (await response.json()) as { items?: GoogleBooksItem[] };
  const books = (data.items ?? []).map(parseItem);
  logger.info(
    { query, items: books.length, durationMs: Date.now() - start },
    "Google Books query",
  );
  return books;
}

/** Single Google Books search for user-typed queries (no retry ladder). */
export async function searchBooksByQuery(
  query: string,
  quotaUser?: string,
): Promise<Book[]> {
  return querySingle(query, quotaUser);
}

/**
 * Searches Google Books for [query] ("title" or "title author"), using a
 * "retry ladder": if the full query returns nothing, trailing words are
 * dropped one at a time, since the title at the front is the most reliable
 * part. Returns an empty list if no variant returns results.
 */
export async function searchWithRetryLadder(
  query: string,
  quotaUser?: string,
): Promise<Book[]> {
  const words = query.trim().split(/\s+/).filter(Boolean);

  for (let len = words.length; len >= 1; len--) {
    const step = words.slice(0, len).join(" ");
    const results = await querySingle(step, quotaUser);
    if (results.length > 0) {
      if (len < words.length) {
        logger.info(
          { query, matchedOn: step, droppedWords: words.length - len },
          "Retry ladder found results after dropping words",
        );
      }
      return results;
    }
  }

  logger.info({ query, steps: words.length }, "Retry ladder found nothing");
  return [];
}
