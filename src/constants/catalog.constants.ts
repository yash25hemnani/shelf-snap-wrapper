// Same rule the app and firestore.rules use for library handles
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

// Firestore auto IDs; the "Load more" cursor is a book ID
export const BOOK_ID_PATTERN = /^[A-Za-z0-9]{1,40}$/;

// Books per catalog page. Each page view costs 2 reads + this many.
export const CATALOG_PAGE_SIZE = 48;

// Vercel's CDN keeps a page this long, so repeat visits cost no reads
export const CATALOG_CACHE_SECONDS = 300;
export const CATALOG_STALE_SECONDS = 3600;

export const APP_URL = "https://shelf-scan-28d17.web.app";

// The Android app's id and link scheme, for the Join button. The app opens
// shelfsnap://lib/{handle} on the library's page.
export const ANDROID_PACKAGE = "com.yashhemnani.shelfsnap";
export const APP_SCHEME = "shelfsnap";
export const SOURCE_URL = "https://github.com/yash25hemnani/shelf-snap";

// Credit in the page's bottom corner
export const AUTHOR_NAME = "Yash Hemnani";
export const AUTHOR_GITHUB = "https://github.com/yash25hemnani";
export const AUTHOR_LINKEDIN = "https://www.linkedin.com/in/yash-hemnani-yh25/";

// Banner keys the app stores, mapped to photos in public/catalog/
export const BANNERS: Record<string, string> = {
  "banner-1": "/catalog/banner-1.jpg",
  "banner-2": "/catalog/banner-2.jpg",
};
export const DEFAULT_BANNER = "banner-1";
