import { Book, ScoredBook } from "../types/books.types";

/** Lowercase, trim, strip punctuation. */
function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s]/g, "");
}

// Same algorithm as the string_similarity package the app used before, so
// scores (and the threshold) stay comparable.
function diceCoefficient(a: string, b: string): number {
  const first = a.replace(/\s+/g, "");
  const second = b.replace(/\s+/g, "");

  if (first === second) return 1;
  if (first.length < 2 || second.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < first.length - 1; i++) {
    const bigram = first.substring(i, i + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < second.length - 1; i++) {
    const bigram = second.substring(i, i + 2);
    const count = bigrams.get(bigram) ?? 0;
    if (count > 0) {
      bigrams.set(bigram, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (first.length + second.length - 2);
}

/**
 * Scores [candidates] against the identified [title]/[author] and returns
 * them best-match-first. Score is the Dice coefficient over character
 * bigrams (0–1) of the normalized "title author" strings. When [author] is
 * empty only titles are compared, so the candidate's author doesn't drag a
 * correct match down.
 */
export function scoreAndRank(
  title: string,
  author: string,
  candidates: Book[],
): ScoredBook[] {
  const query = normalize(author ? `${title} ${author}` : title);

  return candidates
    .map((candidate) => {
      const candidateText = normalize(
        author
          ? `${candidate.title} ${candidate.authors.join(" ")}`
          : candidate.title,
      );
      return { ...candidate, score: diceCoefficient(query, candidateText) };
    })
    .sort((a, b) => b.score - a.score);
}
