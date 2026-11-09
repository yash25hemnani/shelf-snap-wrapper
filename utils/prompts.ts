import { IdentifyBooksRequestBody } from "../types/books.types";
import {
  GENRE_LABELS,
  MAX_GENRES_PER_BOOK,
} from "../constants/discover.constants";

// The photo is the primary source; on-device OCR blocks ride along as hints
// since they're cheap and sometimes catch small text the model misreads.
export function buildPrompt({
  imageWidth,
  imageHeight,
  blocks,
}: Omit<IdentifyBooksRequestBody, "image" | "imageMimeType">): string {
  const hints = blocks.length
    ? `OCR HINTS (bounding boxes in a ${imageWidth}x${imageHeight} coordinate
space; text is often garbled — trust the photo over these):
${JSON.stringify(blocks)}`
    : "No OCR hints were available for this photo.";

  return `The attached photo shows books on a shelf. Identify each book
whose spine or cover you can see.

Spines are usually vertical, so read rotated text. Titles may be split
across lines, and the author or publisher is often printed separately
near the top or bottom of the same spine.

Use your knowledge of real books to correct partially readable text, but
only list a book if you can actually read enough of its spine to be sure.
Never add books that aren't in the photo. Skip spines that are blurry,
cut off, or unreadable rather than guessing. If the author isn't visible
and you're not sure who wrote it, use an empty string.

${hints}`;
}

// Same spine reading as buildPrompt, plus genre tags from the app's fixed
// list so the app can score each book against the reader's taste.
export function buildDiscoverPrompt({
  imageWidth,
  imageHeight,
  blocks,
}: Omit<IdentifyBooksRequestBody, "image" | "imageMimeType">): string {
  const hints = blocks.length
    ? `OCR HINTS (bounding boxes in a ${imageWidth}x${imageHeight} coordinate
space; text is often garbled — trust the photo over these):
${JSON.stringify(blocks)}`
    : "No OCR hints were available for this photo.";

  return `The attached photo shows books on a shelf. Identify each book
whose spine or cover you can see, and tag it with its genres.

Spines are usually vertical, so read rotated text. Titles may be split
across lines, and the author or publisher is often printed separately
near the top or bottom of the same spine.

Use your knowledge of real books to correct partially readable text, but
only list a book if you can actually read enough of its spine to be sure.
Never add books that aren't in the photo. Skip spines that are blurry,
cut off, or unreadable rather than guessing. If the author isn't visible
and you're not sure who wrote it, use an empty string.

GENRES: for each book, pick up to ${MAX_GENRES_PER_BOOK} genres that best describe
it, using only these exact names:
${GENRE_LABELS.join(", ")}
Base the genres on what you know about the book itself, not on how the
spine looks. If you don't know the book well enough, use an empty array.

${hints}`;
}
