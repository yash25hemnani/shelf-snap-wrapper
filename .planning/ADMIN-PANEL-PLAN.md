# Admin Panel Plan

Built on the wrapper (Express 5 + TypeScript + firebase-admin).

## How the pieces fit

- **The wrapper serves both the pages and the API.** `/admin` serves static HTML and JS pages. `/api/admin/*` is the JSON API behind them, protected by `requireAdmin`.
- **Pages can't be protected on their own.** A browser loading a page doesn't send a Bearer header, so the pages are just shells and every bit of data comes through the API.
  - The login page uses the Firebase web SDK. It calls `getIdTokenResult(true)` and checks `claims.admin`.
  - Each page then fetches with the token, and the server checks the claim again on every call.
- **Firestore rules stay as they are.** The new collections are written only by the wrapper through the admin SDK, so the rules deny clients completely. The one exception is `config/app`, which signed-in users can read.

## The 6 phases

### Phase 1: Admin foundation

- Script to grant the first admin: `setCustomUserClaims(uid, { admin: true })`.
- `requireAdmin` middleware in `middleware/`, and an admin router under `/api/admin`.
- Static `/admin` pages: a login page, a page layout with a nav, and a "not an admin" screen.
- `GET /api/admin/me` as a check that everything works end to end.
- An audit log helper, `logAdminAction(adminUid, action, target, before, after)`, which writes to `adminLog`. It goes in now so every later phase uses it from the start.

### Phase 2: Usage and token tracking in the wrapper

- This comes early because the numbers only start building up once tracking exists.
- **Per user:** after each Groq call, read `response.usage` (prompt, completion and total tokens). Add to `usage/{uid}` with `FieldValue.increment`: tokens, scans, searches, ISBN lookups, `lastUsedAt`.
- **Per day:** add to `usageDaily/{yyyy-mm-dd}`, both totals and per-route counts.
- **Errors:** the error handler writes failures (Groq errors, Google Books 503s, timeouts, empty identifications) to `errorLog`. Give it a Firestore TTL so old entries delete themselves.
- **Averages are computed, not stored:** average tokens per user = total tokens ÷ the number of users with a usage doc, and average per scan = tokens ÷ scans.

### Phase 3: Dashboard

- **Totals:** users, libraries, books, loans and friendships, using `count()` aggregation queries. These cost about 1 read per 1,000 docs, so no extra counter docs are needed.
- **Trends:** last 30 days of `usageDaily` (30 reads), showing scans, searches and tokens per day.
- **Token panel:** total tokens, average per user, average per scan, and the top 10 users by tokens.
- **Error log page:** paged 20 at a time, with a filter by route.

### Phase 4: Users and admins

- Users list and search by @username, paged with `limit` and `startAfter`.
- A user page showing:
  - profile, email (fetched from Auth on the server), signup date and last sign-in
  - their libraries
  - their usage
- **Actions, all written to the audit log:**
  - Change a @username, keeping it unique.
  - Disable or enable an account with `updateUser({ disabled })` and `revokeRefreshTokens`, so a disabled user is signed out within the hour.
  - Delete an account.
  - Grant or revoke admin. Block revoking the last admin, and block revoking yourself.

### Phase 5: Content: libraries, books, loans, friendships and reviews

- **Libraries:** browse any library, see its members and roles, and page through its books.
- **Books:** edit bad data (title, author, ISBN, cover link, genres) and remove junk entries. Keep the library book counts correct by doing it in a transaction.
- **Loans:** list and filter by status, and force-resolve stuck ones (returned, cancelled, lost) so the copies on the book are released.
- **Friendships:** list pending and accepted ones and delete ghost requests.
- **Reviews and display names:** a moderation list, newest first, with a remove action.

### Phase 6: Announcements and the app version check (the only phase with app changes)

- **`config/app` doc** with these fields:
  - `latestVersion` and `latestBuild` (e.g. 1.4.0 / 6)
  - `driveLink`
  - `minBuild`, to force an update if ever needed
  - `announcement` (text, active, an optional link)
- **Admin page:** edit that doc. Saving it writes to the audit log.
- **Rules:** signed-in users can read `config/app` and no client can write it. This goes into both `firestore.rules` and the repo copy, and deploys first.
- **Flutter:** an announcement banner on Home, plus an "Update available" card when the installed build is lower than `latestBuild`. The card opens the Drive link. Needs `package_info_plus` (installed version) and `url_launcher` (to open the link), if the app doesn't have them already.

## Design reference

Stitch mockups live in `.planning/reference/stitch-admin/stitch_admin_dashboard_and_wrapper_api/`:

| Folder | Covers | Phase |
|---|---|---|
| `forest_editorial_admin/DESIGN.md` | Theme tokens (colors, type, radii), aligned to the app's `app_colors.dart` / `app_theme.dart` | All |
| `user_directory_full_width_with_slide_over_drawer/` | User list, search, filters, user detail drawer (has `screen.png`) | 4 |
| `telemetry_token_tracking/` | Token panel and usage trends | 3 |
| `audit_log_security_feed/` | Audit log feed (and nav shows an Error Log page) | 1, 3 |
| `content_catalog_moderation/` | Libraries, books, moderation | 5 |
| `remote_config_mobile_release_manager_full_width/` | `config/app` editor: versions, Drive link, force update, announcement banner (has `screen.png`) | 6 |

Notes on using them:
- Theme rules: light only, white cards with a 1px `#E2E8E4` border, no shadows, pill buttons, DM Sans. The mockup HTML loads Google Sans instead; DESIGN.md wins.
- Mockups use the Tailwind Play CDN and Material Symbols. Fine for static pages, but pin the versions.
- Nav from the mockups: Dashboard, Audit Log, Token Tracking, Error Log, User Directory, Content & Libraries, Remote Config.
- Mockups show things the plan has no data for: Invite User, Export, roles beyond admin/member (Superadmin, Curator), a "Throttled" status, OTA URL, target audience cohorts, version adoption stats, config revision history with drafts. Treat them as out of scope unless a phase adds them.

## Open decisions (settle when the phase is reached)

1. **Deleting an account (Phase 4):** delete only the Auth account and the profile, or also their logs, and their libraries where they're the sole owner? Leaning: the first, and leave shared libraries alone.
2. **How to write the pages (Phase 1):** plain HTML with vanilla JS, or a small bundled setup. Leaning: plain static files in a `public/admin` folder, the simplest with Vercel and Express.
3. **Reviews (Phase 5):** where reviews live depends on whether the Friends milestone split them out of the log doc. Phase 5 adapts to whichever way is chosen.
