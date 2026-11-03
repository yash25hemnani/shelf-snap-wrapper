# shelf-snap-groq-wrapper

A thin Express/TypeScript API that wraps the Groq API (`llama-3.3-70b-versatile`) to identify books from OCR'd photos of a bookshelf. The client sends OCR text blocks (with bounding boxes) from a shelf photo, and the model groups them into individual books, inferring the most likely title/author even when the OCR text is garbled.

## How it works

1. Client OCRs a bookshelf photo and posts the resulting text blocks (with pixel bounding boxes) to `POST /identify-books`.
2. The server builds a prompt describing the image dimensions and blocks, and asks the model to group blocks into books and infer title/author for each group.
3. The model replies in Groq's JSON object mode with the expected schema described in the prompt. The server validates the shape, drops malformed entries, and returns `{ books: [{ title, author }, ...] }`.

## Setup

```bash
npm install
```

Create a `.env` file in the project root:

| Variable               | Required | Description                                                                 |
| ---------------------- | -------- | ----------------------------------------------------------------------------- |
| `GROQ_API_KEY`         | yes      | API key for the Groq API. The server refuses to start without it.             |
| `FIREBASE_PROJECT_ID`  | yes      | Firebase project ID for the service account used to verify ID tokens.         |
| `FIREBASE_CLIENT_EMAIL`| yes      | Service account client email (from the Firebase service account JSON).        |
| `FIREBASE_PRIVATE_KEY` | yes      | Service account private key. The server refuses to start without these.      |
| `OPENLIBRARY_CONTACT`  | no       | Contact email sent in the Open Library User-Agent (raises limit to 3 req/s).  |
| `PORT`                 | no       | Port to listen on (default `3000`).                                           |
| `LOG_LEVEL`            | no       | Pino log level (default `info`).                                              |
| `NODE_ENV`             | no       | Set to `production` to log structured JSON instead of pretty-printed output.  |

## Running

```bash
npm run dev    # ts-node, no build step
npm run build  # compile to dist/
npm start      # run the compiled output
```

## API

### `POST /identify-books`

**Headers**: `Authorization: Bearer <Firebase ID token>`

**Body**

```json
{
  "imageWidth": 1080,
  "imageHeight": 1920,
  "blocks": [
    { "text": "THE GREAT GATSBY", "x": 10, "y": 20, "width": 100, "height": 30 }
  ]
}
```

Each block must have a `text` field; any other fields (e.g. bounding box coordinates) are passed through as-is to the model (see `OcrBlock` in [types/books.types.ts](types/books.types.ts)). `blocks` must be non-empty and capped at `MAX_BLOCKS` (see [constants/books.constants.ts](constants/books.constants.ts)).

**Response**

```json
{ "books": [{ "title": "The Great Gatsby", "author": "F. Scott Fitzgerald" }] }
```

On failure: `{ "error": "..." }` with a `400`, `401`, or `502` status.

### `GET /search-books`

Searches Open Library using one or more structured parameters. Provide at least
one of `title`, `author`, or `genre`; `title` and `author` can be combined.
Genre terms can be repeated or comma-separated and their results are merged.

| Parameter | Description |
| --------- | ----------- |
| `title` | Match title words. |
| `author` | Match author; returned results are filtered for the full author name. |
| `genre` | Open Library subject term; supports repeated or comma-separated terms. |
| `page` | 1-based page number (default `1`). |
| `limit` | Results per page, from `1` to `100` (default `10`). |

Examples:

```text
GET /search-books?title=the%20hobbit
GET /search-books?author=toni%20morrison
GET /search-books?title=dune&author=frank%20herbert
GET /search-books?genre=science%20fiction,horror&author=stephen%20king
```

The response includes pagination metadata:

```json
{
  "books": [],
  "page": 1,
  "limit": 10,
  "total": 123
}
```

`total` comes from Open Library's matching-document counts. Because author
searches are filtered client-side and genre terms can overlap, it may differ
from the number of distinct books returned.

## Notes

- Every route requires a valid Firebase ID token (see [middleware/auth.middleware.ts](middleware/auth.middleware.ts)). Sign in with the Firebase client SDK and send the resulting ID token as `Authorization: Bearer <token>`; the server verifies it against your Firebase project via the Admin SDK (configured in [config/firebase.ts](config/firebase.ts)).
- Requests and Groq call timing are logged via [pino](https://github.com/pinojs/pino) (see [utils/logger.ts](utils/logger.ts)); HTTP request/response logging is wired up in [server.ts](server.ts) via `pino-http`.
