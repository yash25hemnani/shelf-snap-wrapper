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
  first_publish_year?: number;
  number_of_pages_median?: number;
  subject?: string[];
  editions?: { docs?: OpenLibraryEdition[] };
}

const SEARCH_URL = "https://openlibrary.org/search.json";
const COVER_URL = "https://covers.openlibrary.org/b/id";
const RETRY_DELAY_MS = 1000;
const SEARCH_FIELDS = "key,title,author_name,first_publish_year,cover_i";
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
const SEARCH_DELAY_MS = OPENLIBRARY_CONTACT ? 334 : RETRY_DELAY_MS;

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

export interface OpenLibrarySearchOptions {
  title?: string;
  author?: string;
  genres?: string[];
  page: number;
  limit: number;
}

export interface OpenLibrarySearchResult {
  books: Book[];
  total: number;
}

function parseSearchDoc(doc: OpenLibraryDoc): Book {
  const coverId = doc.cover_i;
  return {
    googleBooksId: null,
    workId: doc.key?.replace(/^\/works\//, "") ?? null,
    isbn: null,
    title: doc.title ?? "Unknown Title",
    subtitle: null,
    authors: doc.author_name ?? [],
    description: null,
    categories: [],
    publisher: null,
    publishedDate: doc.first_publish_year
      ? String(doc.first_publish_year)
      : null,
    pageCount: null,
    language: null,
    coverUrl: coverId ? `${COVER_URL}/${coverId}-M.jpg` : null,
    source: "openlibrary",
  };
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Searches Open Library with structured fields. Multiple genres are queried
 * independently and merged by work key.
 */
export async function searchBooks(
  options: OpenLibrarySearchOptions,
): Promise<OpenLibrarySearchResult> {
  const genres = options.genres?.length ? options.genres : [undefined];
  const headers = { "User-Agent": USER_AGENT };
  const start = Date.now();
  const results: { docs?: OpenLibraryDoc[]; numFound?: number }[] = [];
  for (const [index, genre] of genres.entries()) {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY_MS));
    }

    const params = new URLSearchParams({
      fields: SEARCH_FIELDS,
      limit: String(options.limit),
      page: String(options.page),
    });
    if (options.title) params.set("title", options.title);
    if (options.author) params.set("author", options.author);
    if (genre) params.set("subject", genre);
    if (
      (!options.title && options.author && !genre) ||
      (genre && !options.author)
    ) {
      params.set("sort", "editions");
    }

    const url = `${SEARCH_URL}?${params}`;
    let response = await fetch(url, { headers });
    if (response.status === 429 || response.status >= 500) {
      logger.warn(
        {
          title: options.title,
          author: options.author,
          genre,
          status: response.status,
        },
        "Open Library search retry",
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      response = await fetch(url, { headers });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error(
        {
          title: options.title,
          author: options.author,
          genre,
          status: response.status,
          durationMs: Date.now() - start,
          body: body.slice(0, 300),
        },
        "Open Library search failed",
      );
      throw new Error(`Open Library API error: ${response.status}`);
    }

    results.push((await response.json()) as {
      docs?: OpenLibraryDoc[];
      numFound?: number;
    });
  }

  const author = options.author ? normalizedName(options.author) : null;
  const byWork = new Map<string, Book>();
  let total = 0;
  for (const result of results) {
    total += result.numFound ?? 0;
    for (const doc of result.docs ?? []) {
      if (
        author &&
        !(doc.author_name ?? []).some((name) =>
          normalizedName(name).includes(author),
        )
      ) {
        continue;
      }
      const book = parseSearchDoc(doc);
      const key = book.workId ?? `${book.title}:${book.authors.join(",")}`;
      byWork.set(key, book);
    }
  }

  const books = [...byWork.values()].slice(0, options.limit);
  logger.info(
    {
      title: options.title,
      author: options.author,
      genres: options.genres,
      page: options.page,
      limit: options.limit,
      items: books.length,
      total,
      durationMs: Date.now() - start,
    },
    "Open Library search",
  );
  return { books, total };
}

/**
 * Looks up a book by exact ISBN. Used instead of Google Books, whose "isbn:"
 * filter returns no results for our key. Returns an empty list if not found.
 */
export async function searchByIsbn(isbn: string): Promise<Book[]> {
  const cached = cache.get(isbn);
  if (cached) {
    logger.info({ isbn, title: cached[0]?.title }, "Open Library cache hit");
    return cached;
  }

  const url = `${SEARCH_URL}?isbn=${encodeURIComponent(isbn)}&fields=${FIELDS}&limit=1`;
  const headers = { "User-Agent": USER_AGENT };
  const start = Date.now();

  let response = await fetch(url, { headers });
  // 429 and 5xx are usually transient; one delayed retry stays within the
  // rate limit.
  if (response.status === 429 || response.status >= 500) {
    logger.warn({ isbn, status: response.status }, "Open Library retry");
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await fetch(url, { headers });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error(
      {
        isbn,
        status: response.status,
        durationMs: Date.now() - start,
        body: body.slice(0, 300),
      },
      "Open Library request failed",
    );
    throw new Error(`Open Library API error: ${response.status}`);
  }

  const data = (await response.json()) as { docs?: OpenLibraryDoc[] };
  const books = (data.docs ?? []).map((doc) => parseDoc(doc, isbn));
  const [book] = books;

  logger.info(
    book
      ? {
          isbn,
          durationMs: Date.now() - start,
          title: book.title,
          authors: book.authors,
          hasCover: book.coverUrl !== null,
          workId: book.workId,
        }
      : { isbn, durationMs: Date.now() - start },
    book ? "Open Library ISBN match" : "Open Library ISBN not found",
  );

  if (books.length > 0) cache.set(isbn, books);
  return books;
}
