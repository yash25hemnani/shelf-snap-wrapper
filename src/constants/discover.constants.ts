// The app's fixed genres: model-facing label -> app Genre enum name. The
// model picks from the readable labels; the response carries the enum names,
// which are what the app stores. Never rename an enum name.
export const GENRES: Record<string, string> = {
  'Fantasy': 'fantasy',
  'Science Fiction': 'scienceFiction',
  'Romance': 'romance',
  'Romantasy': 'romantasy',
  'Mystery': 'mystery',
  'Thriller': 'thriller',
  'Horror': 'horror',
  'Historical Fiction': 'historicalFiction',
  'Literary Fiction': 'literaryFiction',
  'Classics': 'classics',
  'Young Adult': 'youngAdult',
  'LGBTQ+': 'lgbtq',
  'Erotica': 'erotica',
  'Smut': 'smut',
  'BDSM': 'bdsm',
  'Dark Romance': 'darkRomance',
  'Graphic Novels': 'graphicNovels',
  'Manga': 'manga',
  'Poetry': 'poetry',
  'Biography & Memoir': 'biographyMemoir',
  'History': 'history',
  'Self-Help': 'selfHelp',
  'Psychology': 'psychology',
  'True Crime': 'trueCrime',
};

export const GENRE_LABELS = Object.keys(GENRES);

export const MAX_GENRES_PER_BOOK = 2;

// Same as RESPONSE_SCHEMA plus a genres array per book.
export const DISCOVER_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    books: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          author: { type: 'string' },
          genres: {
            type: 'array',
            items: { type: 'string', enum: GENRE_LABELS },
            maxItems: MAX_GENRES_PER_BOOK,
          },
        },
        required: ['title', 'author', 'genres'],
      },
    },
  },
  required: ['books'],
};

export const DISCOVER_SYSTEM_PROMPT = `You identify books from photos of bookshelves and tag each with its genres.
Respond only with a JSON object matching this JSON Schema:
${JSON.stringify(DISCOVER_RESPONSE_SCHEMA)}`;
