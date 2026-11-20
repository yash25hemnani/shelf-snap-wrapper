import { Request, Response } from "express";
import {
  MIN_QUERY_LENGTH,
  MAX_QUERY_LENGTH,
} from "../constants/books.constants";
import { logger } from "../utils/logger";
import { findWikiBook } from "../services/wikipedia.service";

// Wikipedia summary and facts for one book. { book: null } when no page has
// a matching author, so the app can cache "nothing found" too.
export async function getWikipediaBook(req: Request, res: Response) {
  const title =
    typeof req.query.title === "string" ? req.query.title.trim() : "";
  const author =
    typeof req.query.author === "string" ? req.query.author.trim() : "";

  // The author's last name is what confirms the page, so both are required
  if (
    [title, author].some(
      (term) =>
        term.length < MIN_QUERY_LENGTH || term.length > MAX_QUERY_LENGTH,
    )
  ) {
    return res.status(400).json({
      error: `title and author must be between ${MIN_QUERY_LENGTH} and ${MAX_QUERY_LENGTH} characters`,
    });
  }

  try {
    const book = await findWikiBook(title, author);
    res.json({ book });
  } catch (err) {
    logger.error({ err, title, author }, "wikipedia-book failed");
    const throttled = err instanceof Error && err.message.endsWith("429");
    if (throttled) {
      return res
        .status(503)
        .json({ error: "Wikipedia is busy, try again shortly" });
    }
    res.status(502).json({ error: "Failed to reach Wikipedia" });
  }
}
