import type {
  DocumentSnapshot,
  Query,
  QueryDocumentSnapshot,
  QuerySnapshot,
} from "firebase-admin/firestore";

export interface QueryPage {
  docs: QueryDocumentSnapshot[];
  hasMore: boolean;
}

/** Thrown when a query needs a composite index that hasn't been created. */
export class IndexNeededError extends Error {
  constructor(public readonly createUrl: string | null) {
    super("This filter needs a Firestore index");
    this.name = "IndexNeededError";
  }
}

/** An expected failure with the HTTP status and message to send back. */
export class AdminError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

/**
 * Runs [query]. A missing composite index fails with gRPC code 9
 * (FAILED_PRECONDITION) and a console link to create it, which is passed on
 * as IndexNeededError so the page can show the link.
 */
export async function runQuery(query: Query): Promise<QuerySnapshot> {
  try {
    return await query.get();
  } catch (err) {
    if ((err as { code?: number }).code === 9) {
      const url = String((err as Error).message).match(/https:\/\/\S+/)?.[0];
      throw new IndexNeededError(url ?? null);
    }
    throw err;
  }
}

/**
 * One page of [query], starting after [after] when it exists. Reads one
 * extra doc only to tell whether there's another page.
 */
export async function fetchPage(
  query: Query,
  size: number,
  after: DocumentSnapshot | null,
): Promise<QueryPage> {
  let q = query.limit(size + 1);
  if (after?.exists) q = q.startAfter(after);
  const snapshot = await runQuery(q);
  return {
    docs: snapshot.docs.slice(0, size),
    hasMore: snapshot.docs.length > size,
  };
}

/** The cursor for the next page: the last doc's id, or null on the last page. */
export function nextCursor(
  page: QueryPage,
  cursorOf: (doc: QueryDocumentSnapshot) => string = (doc) => doc.id,
) {
  return page.hasMore ? cursorOf(page.docs[page.docs.length - 1]) : null;
}
