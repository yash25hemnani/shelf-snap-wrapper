import {
  ANDROID_PACKAGE,
  APP_SCHEME,
  APP_URL,
  BANNERS,
  SOURCE_URL,
} from "../constants/catalog.constants";
import type { Catalog, CatalogBook } from "../types/catalog.types";

// Everything from Firestore goes through this before it reaches the page
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Colours from the app's AppColors, so the page feels like ShelfSnap
const STYLES = `
:root {
  --primary: #2F6B4F; --primary-dark: #1F4A36; --primary-soft: #E3EFE8;
  --bg: #FFFFFF; --muted: #F4F7F5; --text: #1B2B22; --text-2: #5F6F66;
  --hint: #9AA8A0; --border: #E2E8E4;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.5 "DM Sans", system-ui, sans-serif;
}
a { color: var(--primary); }
a:focus-visible, input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.wrap { max-width: 1040px; margin: 0 auto; padding: 0 16px; }
.hero {
  position: relative; min-height: 240px; display: flex; align-items: flex-end;
  background: var(--primary-dark) center / cover no-repeat;
}
.hero::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(to top, rgba(27,43,34,.85), rgba(27,43,34,.15));
}
.hero .wrap { position: relative; z-index: 1; width: 100%; padding-bottom: 28px; color: #fff; }
.hero h1 { margin: 0; font-size: clamp(28px, 6vw, 44px); line-height: 1.1; letter-spacing: -0.01em; }
.hero p { margin: 8px 0 0; max-width: 60ch; color: rgba(255,255,255,.88); }
.hero .button { margin-top: 16px; background: #fff; color: var(--primary-dark); }
.bar {
  display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
  justify-content: space-between; padding: 20px 0 8px;
}
.bar input {
  flex: 1 1 260px; max-width: 420px; padding: 12px 16px; font: inherit; color: var(--text);
  border: 1px solid var(--border); border-radius: 16px; background: var(--bg);
}
.bar .count { color: var(--text-2); font-size: 14px; }
.grid {
  list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 20px 16px;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
}
.book { min-width: 0; }
.cover {
  aspect-ratio: 2 / 3; border-radius: 12px; overflow: hidden; background: var(--muted);
  border: 1px solid var(--border); display: flex; align-items: center; justify-content: center;
}
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cover span { padding: 12px; text-align: center; font-weight: 600; color: var(--primary-dark); font-size: 14px; }
.book h2 { margin: 8px 0 0; font-size: 15px; line-height: 1.3; font-weight: 600; }
.book p { margin: 2px 0 0; font-size: 13px; color: var(--text-2); }
.empty { padding: 48px 0; color: var(--text-2); }
.more { display: flex; justify-content: center; padding: 32px 0 8px; }
.button {
  display: inline-block; padding: 12px 22px; border-radius: 16px; font-weight: 600;
  text-decoration: none; background: var(--primary); color: #fff;
}
.button.ghost { background: var(--bg); color: var(--primary); border: 1px solid var(--border); }
.about {
  margin: 40px 0 32px; padding: 20px; border: 1px solid var(--border); border-radius: 20px;
  display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between;
}
.about p { margin: 0; max-width: 56ch; color: var(--text-2); }
.about strong { color: var(--text); }
.about .links { display: flex; flex-wrap: wrap; gap: 10px; }
.clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
[hidden] { display: none !important; }
`;

// noindex keeps unlisted libraries, and pages that aren't catalogs, out of
// search results
function layout(
  title: string,
  description: string,
  body: string,
  nonce: string,
  noindex = false,
) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta name="theme-color" content="#2F6B4F">
${noindex ? '<meta name="robots" content="noindex">' : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700&display=swap">
<style>${STYLES}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function about(): string {
  return `<aside class="about">
  <p><strong>This catalog is kept in ShelfSnap</strong>, a free, open-source app for people who own physical books. Scan a shelf, share a library, lend a copy.</p>
  <div class="links">
    <a class="button" href="${APP_URL}">Open ShelfSnap</a>
    <a class="button ghost" href="${SOURCE_URL}">Source on GitHub</a>
  </div>
</aside>`;
}

function bookItem(book: CatalogBook): string {
  const authors = book.authors.join(", ");
  const year = book.publishedDate?.slice(0, 4);
  const cover = book.coverUrl
    ? `<img src="${esc(book.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span>${esc(book.title)}</span>`;
  // Lowercased text the search box matches against
  const search = `${book.title} ${book.subtitle ?? ""} ${authors}`.toLowerCase();

  return `<li class="book" data-search="${esc(search)}">
  <div class="cover">${cover}</div>
  <h2 class="clamp">${esc(book.title)}</h2>
  ${authors ? `<p class="clamp">${esc(authors)}${year ? ` · ${esc(year)}` : ""}</p>` : ""}
</li>`;
}

export function renderCatalog(catalog: Catalog, nonce: string): string {
  const { library, books, nextCursor, handle } = catalog;
  const banner = BANNERS[library.banner];
  const description =
    library.description ?? `Books in ${library.name}, shared with ShelfSnap.`;

  const list = books.length
    ? `<ul class="grid" id="books">${books.map(bookItem).join("")}</ul>
<p class="empty" id="no-match" hidden>No books on this page match your search.</p>`
    : `<p class="empty">No public books here yet.</p>`;

  const more = nextCursor
    ? `<div class="more"><a class="button ghost" href="/lib/${esc(handle)}?after=${esc(nextCursor)}">More books</a></div>`
    : "";

  // Join opens the library in the app, where people ask to join. The web
  // app's address is the default; on Android it becomes an intent link that
  // opens the installed app and falls back to the web app without it.
  const webJoin = `${APP_URL}/lib/${handle}`;
  const androidJoin = `intent://lib/${handle}#Intent;scheme=${APP_SCHEME};package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(webJoin)};end`;
  const joinScript = `<script nonce="${nonce}">
if (/Android/i.test(navigator.userAgent)) {
  document.getElementById("join").href = ${JSON.stringify(androidJoin)};
}
</script>`;

  // Filters the books already on the page; no extra requests or reads
  const script = books.length
    ? `<script nonce="${nonce}">
(() => {
  const input = document.getElementById("search");
  const items = [...document.querySelectorAll("#books .book")];
  const none = document.getElementById("no-match");
  input.hidden = false;
  input.addEventListener("input", () => {
    const words = input.value.toLowerCase().split(/\\s+/).filter(Boolean);
    let shown = 0;
    for (const item of items) {
      const match = words.every((w) => item.dataset.search.includes(w));
      item.hidden = !match;
      if (match) shown++;
    }
    none.hidden = shown > 0;
  });
})();
</script>`
    : "";

  const body = `<header class="hero" style="background-image:url('${banner}')">
  <div class="wrap">
    <h1>${esc(library.name)}</h1>
    ${library.description ? `<p>${esc(library.description)}</p>` : ""}
    <a class="button" id="join" href="${esc(webJoin)}">Join in ShelfSnap</a>
  </div>
</header>
<main class="wrap">
  <div class="bar">
    <input id="search" type="search" placeholder="Search these books" aria-label="Search these books" autocomplete="off" hidden>
    <span class="count">${books.length} book${books.length === 1 ? "" : "s"}${nextCursor ? " on this page" : ""}</span>
  </div>
  ${list}
  ${more}
  ${about()}
</main>
${joinScript}
${script}`;

  return layout(
    `${library.name} · ShelfSnap`,
    description,
    body,
    nonce,
    library.unlisted,
  );
}

export function renderNotFound(nonce: string): string {
  const body = `<main class="wrap" style="padding-top:64px">
  <h1 style="margin:0;font-size:32px">No public library here</h1>
  <p style="color:var(--text-2);max-width:56ch">This address doesn't belong to a public library. It may have been changed, or the library may now be private.</p>
  ${about()}
</main>`;
  return layout("Library not found · ShelfSnap", "No public library at this address.", body, nonce, true);
}

export function renderError(nonce: string): string {
  const body = `<main class="wrap" style="padding-top:64px">
  <h1 style="margin:0;font-size:32px">This catalog didn't load</h1>
  <p style="color:var(--text-2);max-width:56ch">Something went wrong on our side. Refresh the page in a minute.</p>
</main>`;
  return layout("Catalog unavailable · ShelfSnap", "This catalog didn't load.", body, nonce, true);
}
