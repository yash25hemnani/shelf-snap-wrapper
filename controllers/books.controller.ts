import { Request, Response } from "express";
import {
  MAX_BLOCKS,
  MIN_QUERY_LENGTH,
  MAX_QUERY_LENGTH,
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BASE64_LENGTH,
  STRONG_MATCH_THRESHOLD,
} from "../constants/books.constants";
import { logger } from "../utils/logger";
import { buildPrompt } from "../utils/prompts";
import { searchWithRetryLadder } from "../services/google-books.service";
import {
  parseIsbn,
  searchBooks as searchOpenLibrary,
  searchByIsbn,
} from "../services/open-library.service";
import { scoreAndRank } from "../services/match-scoring.service";
import {
  identifySpines,
  ModelsUnavailableError,
} from "../services/vision.service";
import { ScoredBook, SpineGuess } from "../types/books.types";

/**
 * True if [value] is an object with a string title and author. The models'
 * JSON mode guarantees valid JSON but not this shape, so each entry is checked.
 */
function isValidSpineGuess(value: unknown): value is SpineGuess {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SpineGuess).title === "string" &&
    typeof (value as SpineGuess).author === "string"
  );
}

/**
 * Finds the best Google Books listing for an identified book. Returns null
 * (and logs why) if the lookup fails, finds nothing, or the best match is
 * too weak to trust.
 */
async function lookUpBook(
  { title, author }: SpineGuess,
  quotaUser?: string,
): Promise<ScoredBook | null> {
  const query = author ? `${title} ${author}` : title;

  let candidates;
  try {
    candidates = await searchWithRetryLadder(query, quotaUser);
  } catch (err) {
    logger.warn({ query, err }, "Google Books lookup failed");
    return null;
  }

  const ranked = scoreAndRank(title, author, candidates);
  const [topMatch] = ranked;
  if (!topMatch) {
    logger.info({ query }, "No Google Books match");
    return null;
  }

  // Top few candidates, to see why a book matched or was rejected
  logger.info(
    {
      spine: { title, author },
      candidates: candidates.length,
      top: ranked.slice(0, 3).map((b) => ({
        score: Number(b.score.toFixed(2)),
        title: b.title,
        authors: b.authors,
      })),
      threshold: STRONG_MATCH_THRESHOLD,
    },
    "Scored candidates",
  );
  if (topMatch.score < STRONG_MATCH_THRESHOLD) {
    logger.info(
      {
        query,
        matchTitle: topMatch.title,
        matchAuthors: topMatch.authors,
        score: Number(topMatch.score.toFixed(2)),
      },
      "Rejected weak match",
    );
    return null;
  }

  logger.info(
    {
      query,
      matchTitle: topMatch.title,
      score: Number(topMatch.score.toFixed(2)),
    },
    "Matched",
  );
  return topMatch;
}

/** Two spines can resolve to the same listing; keep the higher score. */
function dedupeByTitle(books: ScoredBook[]): ScoredBook[] {
  const byTitle = new Map<string, ScoredBook>();
  for (const book of books) {
    const key = book.title.toLowerCase();
    const existing = byTitle.get(key);
    if (!existing || book.score > existing.score) byTitle.set(key, book);
  }
  return [...byTitle.values()];
}

export async function searchBooks(req: Request, res: Response) {
  const title =
    typeof req.query.title === "string" ? req.query.title.trim() : undefined;
  const author =
    typeof req.query.author === "string" ? req.query.author.trim() : undefined;
  const genreValues = Array.isArray(req.query.genre)
    ? req.query.genre.filter(
        (value): value is string => typeof value === "string",
      )
    : typeof req.query.genre === "string"
      ? [req.query.genre]
      : [];
  const genres = genreValues.flatMap((value) =>
    value
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean),
  );
  const uniqueGenres = [...new Set(genres)];
  const pageValue = typeof req.query.page === "string" ? req.query.page : "1";
  const limitValue =
    typeof req.query.limit === "string" ? req.query.limit : "10";
  const page = /^\d+$/.test(pageValue) ? Number(pageValue) : NaN;
  const limit = /^\d+$/.test(limitValue) ? Number(limitValue) : NaN;

  if (!title && !author && uniqueGenres.length === 0) {
    return res.status(400).json({
      error: "Provide at least one of title, author, or genre",
    });
  }
  const terms = [title, author, ...uniqueGenres].filter(
    (term): term is string => term !== undefined && term.length > 0,
  );
  if (
    terms.some(
      (term) =>
        term.length < MIN_QUERY_LENGTH || term.length > MAX_QUERY_LENGTH,
    )
  ) {
    return res.status(400).json({
      error: `Search terms must be between ${MIN_QUERY_LENGTH} and ${MAX_QUERY_LENGTH} characters`,
    });
  }
  if (!Number.isSafeInteger(page) || page < 1) {
    return res.status(400).json({ error: "page must be a positive integer" });
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return res
      .status(400)
      .json({ error: "limit must be an integer between 1 and 100" });
  }

  try {
    const result = await searchOpenLibrary({
      title,
      author,
      genres: uniqueGenres,
      page,
      limit,
    });
    res.json({ books: result.books, page, limit, total: result.total });
  } catch (err) {
    logger.error(
      { err, title, author, genres: uniqueGenres },
      "search-books failed",
    );

    // Open Library search failures include the HTTP status in the message.
    const throttled = err instanceof Error && err.message.endsWith("429");
    if (throttled) {
      return res
        .status(503)
        .json({ error: "Search is busy, try again shortly" });
    }
    res.status(502).json({ error: "Failed to reach Open Library" });
  }
}

/** Google's "isbn:" filter returns nothing for us, so ISBNs go to Open Library. */
export async function searchBookByIsbn(req: Request, res: Response) {
  const raw = typeof req.query.isbn === "string" ? req.query.isbn : "";
  const isbn = parseIsbn(raw);

  if (!isbn) {
    logger.info({ raw }, "isbn-search rejected invalid ISBN");
    return res
      .status(400)
      .json({ error: "isbn must be a 10- or 13-digit ISBN" });
  }

  try {
    const books = await searchByIsbn(isbn);
    res.json({ books });
  } catch (err) {
    logger.error({ err, isbn }, "isbn-search failed");
    res.status(502).json({ error: "Failed to reach Open Library" });
  }
}

// Identify books from an image using Groq, or Gemini if Groq is rate limited
export async function identifyBooks(req: Request, res: Response) {
  const { image, imageMimeType, imageWidth, imageHeight } = req.body ?? {};
  const blocks = req.body?.blocks ?? [];

  if (typeof image !== "string" || image.length === 0) {
    return res.status(400).json({ error: "image must be a base64 string" });
  }
  if (image.length > MAX_IMAGE_BASE64_LENGTH) {
    return res.status(413).json({ error: "Image too large" });
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(imageMimeType)) {
    return res.status(400).json({ error: "Unsupported imageMimeType" });
  }
  if (!Array.isArray(blocks)) {
    return res.status(400).json({ error: "blocks must be an array" });
  }
  if (blocks.length > MAX_BLOCKS) {
    return res.status(400).json({ error: "Too many blocks in one request" });
  }

  logger.info(
    {
      blockCount: blocks.length,
      imageKb: Math.round((image.length * 3) / 4 / 1024),
      imageWidth,
      imageHeight,
    },
    "identify-books request received",
  );

  try {
    const modelStart = Date.now();
    const { provider, responseText } = await identifySpines({
      prompt: buildPrompt({ imageWidth, imageHeight, blocks }),
      image,
      imageMimeType,
    });

    logger.info(
      { provider, durationMs: Date.now() - modelStart, responseText },
      "Model call completed",
    );

    // JSON mode guarantees syntactically valid JSON but not that it
    // matches RESPONSE_SCHEMA, so we still guard the parse and the shape.
    let parsed: { books?: unknown };

    try {
      parsed = JSON.parse(responseText);
    } catch (err) {
      logger.error({ provider, responseText }, "Failed to parse model response as JSON");
      return res.status(502).json({ error: "Model returned malformed JSON" });
    }

    // Check if returned response has books array
    if (!Array.isArray(parsed?.books)) {
      logger.error({ provider, parsed }, "Model response had no books array");
      return res
        .status(502)
        .json({ error: "Model response had no books array" });
    }

    const identified: SpineGuess[] = parsed.books
      .filter(isValidSpineGuess)
      .filter((b) => b.title.trim().length > 0);
      
    logger.info(
      {
        count: identified.length,
        spines: identified.map((b) => `${b.title} | ${b.author}`),
      },
      "Model identified spines",
    );

    if (identified.length !== parsed.books.length) {
      logger.warn(
        { dropped: parsed.books.length - identified.length },
        "Dropped malformed book entries from model response",
      );
    }

    // Lookups run in parallel; a failed one only drops that book.
    const lookupStart = Date.now();
    const matches = await Promise.all(
      identified.map((guess) => lookUpBook(guess, req.user?.uid)),
    );
    const books = dedupeByTitle(
      matches.filter((m): m is ScoredBook => m !== null),
    );
    logger.info(
      { durationMs: Date.now() - lookupStart },
      "Google Books lookups completed",
    );

    logger.info(
      {
        identifiedCount: identified.length,
        bookCount: books.length,
        books: books.map((b) => b.title),
      },
      "identifyBooks succeeded",
    );
    res.json({ books });
  } catch (err) {
    if (err instanceof ModelsUnavailableError) {
      logger.error("Groq and Gemini both unavailable");
      return res.status(503).json({ error: "Models not available" });
    }
    logger.error({ err }, "Identify books failed");
    res.status(502).json({ error: "Failed to identify books" });
  }
}

export function getHealth(req: Request, res: Response) {
  res.json({ status: "ok" });
}
