import { Request, Response } from "express";
import {
  MAX_BLOCKS,
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BASE64_LENGTH,
  STRONG_MATCH_THRESHOLD,
} from "../constants/books.constants";
import {
  DISCOVER_SYSTEM_PROMPT,
  GENRES,
  MAX_GENRES_PER_BOOK,
} from "../constants/discover.constants";
import { logger } from "../utils/logger";
import { buildDiscoverPrompt } from "../utils/prompts";
import { searchWithRetryLadder } from "../services/google-books.service";
import { scoreAndRank } from "../services/match-scoring.service";
import {
  identifySpines,
  ModelsUnavailableError,
} from "../services/vision.service";
import {
  DiscoveredBook,
  DiscoverSpineGuess,
  ScoredBook,
} from "../types/books.types";

// Case-insensitive label -> app Genre enum name
const GENRE_BY_LABEL = new Map(
  Object.entries(GENRES).map(([label, name]) => [label.toLowerCase(), name]),
);

/**
 * True if [value] has a string title and author. genres isn't checked here;
 * a missing or bad genres value just becomes [] in toGenreNames.
 */
function isValidGuess(value: unknown): value is DiscoverSpineGuess {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as DiscoverSpineGuess).title === "string" &&
    typeof (value as DiscoverSpineGuess).author === "string"
  );
}

/**
 * Keeps only labels from the fixed list, as enum names, deduped and capped.
 * The schema asks for this, but JSON mode doesn't enforce it.
 */
function toGenreNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names = raw
    .filter((g): g is string => typeof g === "string")
    .map((g) => GENRE_BY_LABEL.get(g.trim().toLowerCase()))
    .filter((name): name is string => name !== undefined);
  return [...new Set(names)].slice(0, MAX_GENRES_PER_BOOK);
}

/** Best Google Books listing for a spine, or null if none is strong enough. */
async function lookUpBook(
  title: string,
  author: string,
  quotaUser?: string,
): Promise<ScoredBook | null> {
  const query = author ? `${title} ${author}` : title;

  let candidates;
  try {
    candidates = await searchWithRetryLadder(query, quotaUser);
  } catch (err) {
    logger.warn({ query, err }, "Discover: Google Books lookup failed");
    return null;
  }

  const [topMatch] = scoreAndRank(title, author, candidates);
  if (!topMatch || topMatch.score < STRONG_MATCH_THRESHOLD) {
    logger.info(
      {
        query,
        matchTitle: topMatch?.title,
        score: topMatch ? Number(topMatch.score.toFixed(2)) : null,
      },
      "Discover: no strong match",
    );
    return null;
  }
  return topMatch;
}

/** Two spines can resolve to the same listing; keep the higher score. */
function dedupeByTitle(books: DiscoveredBook[]): DiscoveredBook[] {
  const byTitle = new Map<string, DiscoveredBook>();
  for (const book of books) {
    const key = book.title.toLowerCase();
    const existing = byTitle.get(key);
    if (!existing || book.score > existing.score) byTitle.set(key, book);
  }
  return [...byTitle.values()];
}

// Same as identifyBooks, but each book also comes back with 0–2 genres
// (app Genre enum names) so the app can score it against the reader's taste.
export async function discoverBooks(req: Request, res: Response) {
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
    "discover request received",
  );

  try {
    const modelStart = Date.now();
    const { provider, responseText } = await identifySpines({
      prompt: buildDiscoverPrompt({ imageWidth, imageHeight, blocks }),
      systemPrompt: DISCOVER_SYSTEM_PROMPT,
      image,
      imageMimeType,
    });

    logger.info(
      { provider, durationMs: Date.now() - modelStart, responseText },
      "Discover: model call completed",
    );

    let parsed: { books?: unknown };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      logger.error({ provider, responseText }, "Discover: malformed JSON");
      return res.status(502).json({ error: "Model returned malformed JSON" });
    }
    if (!Array.isArray(parsed?.books)) {
      logger.error({ provider, parsed }, "Discover: no books array");
      return res
        .status(502)
        .json({ error: "Model response had no books array" });
    }

    const identified = parsed.books
      .filter(isValidGuess)
      .filter((b) => b.title.trim().length > 0)
      .map((b) => ({ ...b, genres: toGenreNames(b.genres) }));

    logger.info(
      {
        count: identified.length,
        spines: identified.map(
          (b) => `${b.title} | ${b.author} | ${b.genres.join(",")}`,
        ),
      },
      "Discover: model identified spines",
    );

    // Lookups run in parallel; a failed one only drops that book.
    const lookupStart = Date.now();
    const matches = await Promise.all(
      identified.map(async (guess): Promise<DiscoveredBook | null> => {
        const match = await lookUpBook(guess.title, guess.author, req.user?.uid);
        return match ? { ...match, genres: guess.genres } : null;
      }),
    );
    const books = dedupeByTitle(
      matches.filter((m): m is DiscoveredBook => m !== null),
    );

    logger.info(
      {
        lookupMs: Date.now() - lookupStart,
        identifiedCount: identified.length,
        bookCount: books.length,
        books: books.map((b) => `${b.title} [${b.genres.join(",")}]`),
      },
      "discoverBooks succeeded",
    );
    res.json({ books });
  } catch (err) {
    if (err instanceof ModelsUnavailableError) {
      logger.error("Discover: Groq and Gemini both unavailable");
      return res.status(503).json({ error: "Models not available" });
    }
    logger.error({ err }, "Discover failed");
    res.status(502).json({ error: "Failed to discover books" });
  }
}
