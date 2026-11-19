export interface CatalogLibrary {
  name: string;
  description: string | null;
  banner: string;
}

export interface CatalogBook {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  coverUrl: string | null;
  publishedDate: string | null;
}

export interface Catalog {
  handle: string;
  library: CatalogLibrary;
  books: CatalogBook[];
  // ID of the last book shown when there are more; null on the last page
  nextCursor: string | null;
}
