export interface OcrBlock {
  text: string;
  [key: string]: unknown;
}

export interface IdentifyBooksRequestBody {
  image: string; // base64, no data: prefix
  imageMimeType: string;
  imageWidth: number;
  imageHeight: number;
  blocks: OcrBlock[];
}

/** Where a listing's data came from. Google data is usually richer. */
export type BookSource = "google" | "openlibrary";

/**
 * One edition of a book, as returned by every endpoint.
 * Contract: every key is always present. Missing data is null or [], never absent.
 */
export interface Book {
  // Provider ids, hints for matching, never our identity
  googleBooksId: string | null; // Google volume id, e.g. "wrOQLV6xB-wC"
  workId: string | null;        // Open Library work id, without the "/works/" prefix: "OL82586W"
  isbn: string | null;          // always ISBN-13, digits only

  // Book related information
  title: string;
  subtitle: string | null;
  authors: string[];            // ["J.K. Rowling"], the app joins them for display
  description: string | null;   // plain text, HTML stripped
  categories: string[];         // raw provider categories, mapped to fixed tags in step 2.4

  // Edition related information
  publisher: string | null;
  publishedDate: string | null; // as given: "1999", "1999-07" or "1999-07-08"
  pageCount: number | null;
  language: string | null;      // ISO 639-1 code of this edition: "en"
  coverUrl: string | null;      // always https

  source: BookSource;
}

/** A /identify-books result: a listing plus how well it matched the spine. */
export interface ScoredBook extends Book {
  score: number; // 0–1
}

/** What the vision model reads off a spine, before any lookup. */
export interface SpineGuess {
  title: string;
  author: string;
}
