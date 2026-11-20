import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import firebaseApp from "../config/firebase";
import {
  BANNERS,
  CATALOG_PAGE_SIZE,
  DEFAULT_BANNER,
} from "../constants/catalog.constants";
import type { Catalog, CatalogBook } from "../types/catalog.types";

const db = getFirestore(firebaseApp);

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Only https images; Google Books often stores http links that work as https
function safeImageUrl(value: unknown): string | null {
  const url = str(value)?.replace(/^http:\/\//i, "https://");
  return url && url.startsWith("https://") ? url : null;
}

function toBook(id: string, data: DocumentData): CatalogBook {
  return {
    id,
    title: str(data.title) ?? "Untitled",
    subtitle: str(data.subtitle),
    authors: Array.isArray(data.authors)
      ? data.authors.map(str).filter((a): a is string => a !== null)
      : [],
    coverUrl: safeImageUrl(data.coverUrl),
    publishedDate: str(data.publishedDate),
  };
}

// One page of a public or unlisted library's public books, or null when
// the handle doesn't point at one. The admin SDK skips firestore.rules,
// so the access and visibility checks here are what keep private data out.
export async function getCatalog(
  handle: string,
  after: string | null,
): Promise<Catalog | null> {
  const handleDoc = await db.collection("libraryHandles").doc(handle).get();
  const libraryId = str(handleDoc.data()?.libraryId);
  if (!libraryId) return null;

  const libraryRef = db.collection("libraries").doc(libraryId);
  const librarySnap = await libraryRef.get();
  const library = librarySnap.data();
  // The handle must still belong to this library, and it must be open to
  // people with the link; private libraries never get a page
  const open = library?.access === "public" || library?.access === "unlisted";
  if (!library || !open || library.handle !== handle) {
    return null;
  }

  // Same query and index the app uses for non-members
  let query = libraryRef
    .collection("books")
    .where("visibility", "==", "public")
    .orderBy("addedAt", "desc")
    .limit(CATALOG_PAGE_SIZE + 1);

  if (after) {
    const cursor = await libraryRef.collection("books").doc(after).get();
    if (cursor.exists) query = query.startAfter(cursor);
  }

  const snapshot = await query.get();
  // The extra book only tells us whether there's another page
  const docs = snapshot.docs.slice(0, CATALOG_PAGE_SIZE);
  const hasMore = snapshot.docs.length > CATALOG_PAGE_SIZE;

  const banner =
    typeof library.banner === "string" && library.banner in BANNERS
      ? library.banner
      : DEFAULT_BANNER;

  return {
    handle,
    library: {
      name: str(library.name) ?? "Library",
      description: str(library.description),
      banner,
      unlisted: library.access === "unlisted",
    },
    books: docs.map((doc) => toBook(doc.id, doc.data())),
    nextCursor: hasMore ? docs[docs.length - 1].id : null,
  };
}
