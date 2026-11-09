import { logger } from "../utils/logger";
import { WikiBook } from "../types/books.types";

interface WikiPage {
  title: string;
  missing?: boolean;
  fullurl?: string;
  extract?: string;
  thumbnail?: { source: string };
  revisions?: { slots: { main: { content: string } } }[];
}

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKI_TIMEOUT_MS = 8000;
// Wikipedia asks API clients for a User-Agent with a way to reach the owner
const WIKI_CONTACT =
  process.env.WIKI_CONTACT ?? process.env.OPENLIBRARY_CONTACT;
const WIKI_HEADERS = {
  "User-Agent": WIKI_CONTACT ? `ShelfSnap (${WIKI_CONTACT})` : "ShelfSnap",
};
const SEARCH_HITS = 5;
const MAX_GENRES = 5;

/**
 * Raw value of one "| field = ..." infobox entry, or undefined. Values can
 * run over several lines (plainlist genres), up to the next "|" line or "}}".
 */
function infoboxField(content: string, ...names: string[]): string | undefined {
  for (const name of names) {
    const match = content.match(
      new RegExp(`^\\s*\\|\\s*${name}\\s*=([\\s\\S]*?)(?=\\n\\s*\\||\\n\\s*\\}\\})`, "im"),
    );
    if (match && match[1].trim()) return match[1];
  }
  return undefined;
}

/** Wikitext to plain text: links, refs, list templates and markup removed. */
function cleanWikitext(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/<[^>]+>/g, "")
    // {{plainlist|* a * b}}, {{ubl|a|b}}, {{nowrap|a}} keep their items
    .replace(
      /\{\{\s*(?:plain ?list|flat ?list|hlist|ubl|unbulleted list|nowrap)\s*\|/gi,
      "",
    )
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\}\}/g, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/\s*\*\s*/g, ", ")
    .replace(/\s*\|\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .replace(/(,\s*)+/g, ", ");
}

/** True if the page's infobox author contains the author's last name. */
function authorMatches(content: string, lastName: string): boolean {
  const author = infoboxField(content, "author", "authors");
  return author !== undefined && author.toLowerCase().includes(lastName);
}

function toWikiBook(page: WikiPage): WikiBook {
  const content = page.revisions?.[0]?.slots.main.content ?? "";
  const field = (...names: string[]) => {
    const raw = infoboxField(content, ...names);
    const text = raw ? cleanWikitext(raw) : "";
    return text || null;
  };

  // Raw, since the year often sits inside {{Start date|1965|8|1}}
  const published = infoboxField(
    content,
    "publication_date",
    "published",
    "pub_date",
    "release_date",
  );
  // Refs dropped first (they hold dates); "1,138" keeps its thousands
  const pages = infoboxField(content, "pages")
    ?.replace(/<ref[\s\S]*?(?:<\/ref>|\/>)/gi, "")
    .replace(/,(?=\d{3})/g, "")
    .match(/\d+/)?.[0];
  const genres = field("genre", "genres");

  return {
    title: page.title,
    url:
      page.fullurl ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    summary: page.extract?.trim() || null,
    thumbnail: page.thumbnail?.source ?? null,
    publishedYear: published?.match(/\b(1[5-9]|20)\d{2}\b/)?.[0] ?? null,
    pageCount: pages ? Number(pages) : null,
    genres: genres
      ? genres.split(",").map((g) => g.trim()).filter(Boolean).slice(0, MAX_GENRES)
      : [],
    series: field("series"),
    country: field("country", "publication_place"),
    language: field("language"),
  };
}

async function wikiGet<T>(params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({
    ...params,
    format: "json",
    formatversion: "2",
  });
  const response = await fetch(`${WIKI_API}?${query}`, {
    headers: WIKI_HEADERS,
    signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Wikipedia request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Source, intro text, URL and thumbnail for up to 20 titles in one request.
 * Redirects are followed, so a page may come back under a different title.
 */
async function fetchPages(titles: string[]): Promise<{
  pages: WikiPage[];
  redirects: { from: string; to: string }[];
}> {
  const data = await wikiGet<{
    query?: {
      pages?: WikiPage[];
      redirects?: { from: string; to: string }[];
      normalized?: { from: string; to: string }[];
    };
  }>({
    action: "query",
    prop: "revisions|extracts|info|pageimages",
    rvprop: "content",
    rvslots: "main",
    exintro: "1",
    explaintext: "1",
    exlimit: "max",
    inprop: "url",
    piprop: "thumbnail",
    pithumbsize: "400",
    redirects: "1",
    titles: titles.join("|"),
  });
  return {
    pages: (data.query?.pages ?? []).filter((p) => !p.missing),
    // Normalized ("dune" -> "Dune") and redirects both rename a title
    redirects: [
      ...(data.query?.normalized ?? []),
      ...(data.query?.redirects ?? []),
    ],
  };
}

/** The page for [title], following any rename from normalizing or redirects. */
function pageFor(
  title: string,
  pages: WikiPage[],
  renames: { from: string; to: string }[],
): WikiPage | undefined {
  let name = title;
  for (const rename of renames) {
    if (rename.from === name) name = rename.to;
  }
  return pages.find((p) => p.title === name);
}

/**
 * Finds a book's English Wikipedia page by title and author and returns its
 * summary and infobox facts, or null if no page has a matching author.
 */
export async function findWikiBook(
  title: string,
  author: string,
): Promise<WikiBook | null> {
  const lastName = author.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
  const start = Date.now();

  // Likeliest page names first, all fetched in one request
  const guesses = [`${title} (novel)`, `${title} (book)`, title];
  const first = await fetchPages(guesses);
  for (const guess of guesses) {
    const page = pageFor(guess, first.pages, first.redirects);
    const content = page?.revisions?.[0]?.slots.main.content ?? "";
    if (page && authorMatches(content, lastName)) {
      logger.info(
        { title, author, page: page.title, durationMs: Date.now() - start },
        "Wikipedia: matched page name",
      );
      return toWikiBook(page);
    }
  }

  // Fallback: search pages with a book infobox, best hits first
  const search = await wikiGet<{ query?: { search?: { title: string }[] } }>({
    action: "query",
    list: "search",
    srsearch: `"${title.replace(/"/g, "")}" hastemplate:"Infobox book"`,
    srlimit: `${SEARCH_HITS}`,
  });
  const hits = search.query?.search?.map((hit) => hit.title) ?? [];
  if (hits.length > 0) {
    const second = await fetchPages(hits);
    // Walk in search order; pages come back unordered
    for (const hit of hits) {
      const page = pageFor(hit, second.pages, second.redirects);
      const content = page?.revisions?.[0]?.slots.main.content ?? "";
      if (page && authorMatches(content, lastName)) {
        logger.info(
          { title, author, page: page.title, durationMs: Date.now() - start },
          "Wikipedia: matched search hit",
        );
        return toWikiBook(page);
      }
    }
  }

  logger.info(
    { title, author, hits, durationMs: Date.now() - start },
    "Wikipedia: no page with a matching author",
  );
  return null;
}
