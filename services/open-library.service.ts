import { logger } from "../utils/logger";
import { toIsbn13 } from "../utils/isbn";
import { Book } from "../types/books.types";

/** The matched edition, from the search's "editions" subquery. */
interface OpenLibraryEdition {
  title?: string;
  subtitle?: string;
  publisher?: string[];
  publish_date?: string[];
  language?: string[];
  cover_i?: number;
}

interface OpenLibraryDoc {
  key?: string; // "/works/OL82536W"
  title?: string;
  subtitle?: string;
  author_name?: string[];
  cover_i?: number;
  number_of_pages_median?: number;
  subject?: string[];
  editions?: { docs?: OpenLibraryEdition[] };
}

const SEARCH_URL = "https://openlibrary.org/search.json";
const COVER_URL = "https://covers.openlibrary.org/b/id";
const RETRY_DELAY_MS = 1000;
// Open Library subjects run to dozens of tags per work; Google gives a few.
const MAX_CATEGORIES = 5;
// Work-level fields (publisher, language, ...) mix every edition, so edition
// facts come from the edition matching the ISBN instead.
const FIELDS = [
  "key",
  "title",
  "subtitle",
  "author_name",
  "cover_i",
  "number_of_pages_median",
  "subject",
  "editions",
  "editions.title",
  "editions.subtitle",
  "editions.publisher",
  "editions.publish_date",
  "editions.language",
  "editions.cover_i",
].join(",");

// Open Library uses MARC 3-letter codes; the contract wants ISO 639-1.
// Unlisted codes map to null.
const MARC_TO_ISO_639_1: Record<string, string> = {
  ara: "ar",
  chi: "zh",
  cze: "cs",
  dan: "da",
  dut: "nl",
  eng: "en",
  fin: "fi",
  fre: "fr",
  ger: "de",
  gre: "el",
  heb: "he",
  hin: "hi",
  hun: "hu",
  ind: "id",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  nor: "no",
  per: "fa",
  pol: "pl",
  por: "pt",
  rum: "ro",
  rus: "ru",
  spa: "es",
  swe: "sv",
  tha: "th",
  tur: "tr",
  ukr: "uk",
  vie: "vi",
};

// Open Library asks callers to identify themselves with an app name and
// contact; identified requests get 3 req/sec instead of 1.
const OPENLIBRARY_CONTACT = process.env.OPENLIBRARY_CONTACT;
const USER_AGENT = OPENLIBRARY_CONTACT
  ? `ShelfSnap (${OPENLIBRARY_CONTACT})`
  : "ShelfSnap";

if (!OPENLIBRARY_CONTACT) {
  logger.warn(
    "OPENLIBRARY_CONTACT not set — Open Library requests are limited to 1/sec.",
  );
}

// An ISBN always maps to the same book, and Open Library asks callers to
// cache. Only hits are cached so a book added later can still be found.
const cache = new Map<string, Book[]>();

/**
 * Open Library dates are free text ("2001-09", "September 1, 2001", "c1999").
 * ISO-style dates pass through; anything else is cut down to its year.
 */
function normalizeDate(date: string | undefined): string | null {
  if (!date) return null;
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)) return date;
  return date.match(/\b\d{4}\b/)?.[0] ?? null;
}

function parseDoc(doc: OpenLibraryDoc, isbn: string): Book {
  const edition = doc.editions?.docs?.[0] ?? {};
  const coverId = edition.cover_i ?? doc.cover_i;
  const marc = edition.language?.[0];

  return {
    googleBooksId: null,
    workId: doc.key?.replace(/^\/works\//, "") ?? null,
    // The doc lists every edition's ISBNs; the one searched for is the match.
    isbn: toIsbn13(isbn),
    title: edition.title ?? doc.title ?? "Unknown Title",
    subtitle: edition.subtitle ?? doc.subtitle ?? null,
    authors: doc.author_name ?? [],
    // Not in search results; it lives on the separate works endpoint.
    description: null,
    categories: doc.subject?.slice(0, MAX_CATEGORIES) ?? [],
    publisher: edition.publisher?.[0] ?? null,
    publishedDate: normalizeDate(edition.publish_date?.[0]),
    // Search has no per-edition page count; the work's median is closest.
    pageCount: doc.number_of_pages_median ?? null,
    language: marc ? (MARC_TO_ISO_639_1[marc] ?? null) : null,
    coverUrl: coverId ? `${COVER_URL}/${coverId}-M.jpg` : null,
    source: "openlibrary",
  };
}

/**
 * Returns the normalized ISBN if [query] is an ISBN-10 or ISBN-13 (hyphens,
 * spaces and an "isbn:" prefix allowed), otherwise null.
 */
export function parseIsbn(query: string): string | null {
  const isbn = query
    .trim()
    .replace(/^isbn:/i, "")
    .replace(/[-\s]/g, "")
    .toUpperCase();
  return /^(\d{9}[\dX]|\d{13})$/.test(isbn) ? isbn : null;
}

/**
 * Looks up a book by exact ISBN. Used instead of Google Books, whose "isbn:"
 * filter returns no results for our key. Returns an empty list if not found.
 */
export async function searchByIsbn(isbn: string): Promise<Book[]> {
  const cached = cache.get(isbn);
  if (cached) return cached;

  const url = `${SEARCH_URL}?isbn=${encodeURIComponent(isbn)}&fields=${FIELDS}&limit=1`;
  const headers = { "User-Agent": USER_AGENT };

  let response = await fetch(url, { headers });
  // 429 and 5xx are usually transient; one delayed retry stays within the
  // rate limit.
  if (response.status === 429 || response.status >= 500) {
    logger.warn({ isbn, status: response.status }, "Open Library retry");
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await fetch(url, { headers });
  }

  if (!response.ok) {
    throw new Error(`Open Library API error: ${response.status}`);
  }

  const data = (await response.json()) as { docs?: OpenLibraryDoc[] };
  const books = (data.docs ?? []).map((doc) => parseDoc(doc, isbn));
  if (books.length > 0) cache.set(isbn, books);
  return books;
}
