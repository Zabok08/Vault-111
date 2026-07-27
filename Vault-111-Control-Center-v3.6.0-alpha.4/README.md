# Vault 111 Control Center — Version 3.6 alpha.3

This is a production-minded backend scaffold plus a minimal Tampermonkey connection layer. It does not replace the Version 2 planner: the planner remains the UI and local optimizer.

## Included

- Torn identity and faction verification
- AES-256-GCM API-key encryption with versioned keys and user-bound authenticated data
- 15-minute signed access tokens
- Rotating, hashed refresh tokens with revocation
- Server-enforced roles and permissions
- Transactional Torn faction-member and available-OC synchronization
- Self-only Torn crime-stat synchronization for every connected member
- Shared normalized crime totals for client-side planner scoring
- PostgreSQL/Prisma schema for users, sessions, role mappings, faction members, OC crimes, sync state, assignments, and audit events
- Multi-instance-safe database synchronization lock and stale-data metadata
- Optimistic concurrency for assignment edits
- Input validation, origin allow-listing, secure headers, rate limits, log redaction, and bounded requests
- The planner and optimizer with the Version 3 backend connection merged into one Tampermonkey userscript
- A cleaner OC Dashboard with actual Torn vacancies and the connected member's top suggested role
- Keyboard-accessible tabs and member dialogs, persistent focus/scroll state, reduced-motion support, live status announcements, guarded backend actions, and publication-ready UI polish
- A draggable collapsed launcher, single-instance protection, and a compact mobile layout limited to roughly 40% of the stable viewport height
- A full-width responsive tab grid with independently scrolling content, plus denser mobile cards and controls
- Visual-viewport keyboard handling that slides the mobile panel into view and restores it after the keyboard closes
- Mobile route coverage for Torn's direct faction page, alternate page router, bare domain, and Torn subdomains
- Stale-instance replacement and automatic on-screen recovery for launchers left behind by older mobile builds
- Flex-based panel sizing that uses the rendered header height and prevents bottom-edge clipping in expanded and collapsed modes
- Automatic self-only crime-stat synchronization when an authenticated member opens the API Key screen, with a rate-safe five-minute cooldown
- Safe read-only wake checks for free hosting, without replaying sync or assignment mutations
- Render Blueprint and Neon deployment workflow with separate pooled and migration connections
- Shared ranked-war scores, status, start/end countdown, attack feed, and member participation leaderboard
- Server-only ranked-war synchronization for Owner, Admin, and War Manager roles; read-only access for every authenticated faction member
- Current/scheduled opponent target list with public Torn status, hospital timing, search, and direct Attack/Profile links
- Shared per-target officer notes with version-conflict protection; editable by Owner, Admin, War Manager, and Officer
- Shared ranked-war payout drafts with configurable whole-dollar pools and fixed successful-hit points
- One point per ranked-war hit, half a point per out-of-war chain hit, and one-quarter point per out-of-war non-chain hit
- Deterministic whole-dollar allocation, manual bonuses or deductions, and optional adjustment notes
- Finalized payout snapshots that remain locked even if later Torn synchronization changes the attack history
- Owner/Admin/War Manager payout editing, read-only faction-member reports, Admin/Owner reopening, CSV downloads, and audit events
- Responsive payout rows that keep base and final amounts visible, plus a direct link to Torn's faction payout controls
- Opt-in member battle-stat, per-drug, overdose, rehabilitation, and drug-cooldown synchronization
- Six-hour analytics snapshots with previous-sync, 24-hour, 7-day, and 30-day growth calculations
- Exact analytics visible only to the member, Owner, and Administrators; privileged reads and consent changes are audited
- Searchable Member Overview with faction status, last action, OC availability, privacy-aware profiles, and mobile layouts
- On-demand member profiles with the last five synchronized ranked wars, fixed-rule hit points, payout status, and finalized payout totals
- One-click consent withdrawal that deletes the member's stored analytics and history
- Unified faction dashboard with ranked-war, member-availability, finalized-payout, OC-slot, and synchronization-health summaries
- Current faction-chain count and break/cooldown timing sourced from Torn's current-chain endpoint
- Shared faction announcements with pinning, optional expiration, author metadata, optimistic version checks, and audit events
- Owner/Admin/Officer announcement management with read-only access for every other connected faction role
- Shared faction Scheduler with manual Chain, Ranked War, OC, Faction, Meeting, and Other events
- Automatically generated upcoming Ranked War and OC-ready events from synchronized backend data
- Server-enforced schedule permissions: Owner/Admin/Officer manage all events, War Managers manage Chain/Ranked War events, OC Planners manage OC events, and Members are read-only
- Per-member event-type and reminder-time preferences, deduplicated in-app alerts, and optional Tampermonkey browser notifications while Torn is open
- Upcoming-event summaries and live countdowns on the unified Dashboard
- Protected Administration tab for the Owner and Administrators
- Read-only role mappings, user access state, API connection status, synchronization health, and faction-scoped audit history for Administrators
- Owner-only faction-position role mapping, user suspension/restoration, and session revocation
- Immediate access-token invalidation through server-checked session versions
- Optimistic versions for role mappings and user access controls, with affected-session revocation and audit events
- Rate-safe automatic faction/stat synchronization and plan rebuilding when the Planner tab is opened

## Local setup

Requirements: Node.js 22+, Docker Desktop (or PostgreSQL 15+), and Tampermonkey.

1. Copy `.env.example` to `.env`.
2. Set the real numeric `VAULT111_FACTION_ID`.
3. Generate secrets directly into `.env` without displaying them:

   ```powershell
   npm run secrets:generate
   ```

   Back up the completed `.env` securely. Losing its encryption key makes stored Torn API keys unrecoverable.

4. Start PostgreSQL:

   ```powershell
   docker compose up -d
   ```

5. Install and initialize:

   ```powershell
   npm install
   npm run db:generate
   npm run db:migrate -- --name init
   npm run dev
   ```

6. Confirm `http://127.0.0.1:3000/health`.
7. Install `client/Vault-111-Control-Center-v3.6.0-alpha.4.user.js` in Tampermonkey.

## First shared synchronization

The Owner, Administrator, or OC Planner must connect with a Torn key that has minimal access and faction API permission. In the userscript’s **API Key** tab, press **Sync Vault 111 from Torn**.

The backend re-verifies the key owner and faction, synchronizes faction members and Recruiting/Planning crimes in one database transaction, and never returns the API key. Regular Members can refresh and read the resulting shared snapshot but cannot start a Torn synchronization.

Every member can use **Sync My Stats**. Crime-category synchronization remains self-only and publishes only normalized planner totals. Members who explicitly accept the analytics notice can additionally synchronize their own `battlestats`, drug-category `personalstats`, and current cooldown. Exact analytics are returned only to that member, the Owner, and Administrators. Withdrawing consent deletes the current analytics record and its stored history.

For a local command-line check using the already encrypted Owner key:

```powershell
npm run build
npm run sync:run
```

No key value is printed.

## Bootstrap the owner

All first-time users become `MEMBER` unless their Torn faction position is mapped. After the intended owner logs in once, grant the Owner role:

```powershell
npm run owner:grant -- YOUR_NUMERIC_TORN_ID
```

Disconnect and reconnect the userscript so it receives a new Owner access token. Then create `RoleMapping` records for faction positions. Owner status is preserved on subsequent logins; other roles are refreshed from the position mapping.

Map only trusted Torn positions to write-capable roles:

```powershell
npm run role:map -- "Exact Torn Position" OC_PLANNER
```

Unmapped positions remain read-only Members. The `OWNER` role cannot be granted through position mapping.

## REST surface

| Method | Path | Permission |
|---|---|---|
| GET | `/health` | Public |
| POST | `/v1/auth/login` | Valid Vault 111 key |
| POST | `/v1/auth/refresh` | Valid refresh token |
| POST | `/v1/auth/logout` | Refresh token |
| GET | `/v1/me` | Authenticated |
| PUT | `/v1/me/analytics-consent` | Authenticated; self only |
| POST | `/v1/me/analytics/sync` | Authenticated; self only and consent required |
| POST | `/v1/me/crime-stats/sync` | Authenticated; self only |
| GET | `/v1/me/crime-stats` | Authenticated; self only |
| GET | `/v1/members/overview` | `members.read`; exact analytics additionally require self or `members.analytics.read_all` |
| GET | `/v1/members/:tornId/war-history` | `members.read`; target must be an active member of the same faction |
| GET | `/v1/dashboard` | `dashboard.read` |
| POST | `/v1/announcements` | `announcements.manage` |
| PUT | `/v1/announcements/:announcementId` | `announcements.manage` |
| DELETE | `/v1/announcements/:announcementId?expectedVersion=…` | `announcements.manage` |
| GET | `/v1/schedule` | `schedule.read` |
| POST | `/v1/schedule/events` | Type-scoped schedule management |
| PUT | `/v1/schedule/events/:eventId` | Type-scoped schedule management |
| DELETE | `/v1/schedule/events/:eventId?expectedVersion=…` | Type-scoped schedule management |
| PUT | `/v1/me/notification-preferences` | Authenticated; self only |
| POST | `/v1/faction/sync` | `oc.sync` |
| GET | `/v1/faction/members` | `oc.read` |
| GET | `/v1/oc/snapshot` | `oc.read` |
| GET | `/v1/oc/crimes` | `oc.read` |
| PUT | `/v1/oc/crimes/:crimeId/roles/:roleKey` | `oc.assign` |
| POST | `/v1/war/sync` | `war.sync` |
| GET | `/v1/war/snapshot` | `war.read` |
| PUT | `/v1/war/:warId/targets/:targetTornId/note` | `war.notes` |
| GET | `/v1/war/:warId/payout` | `war.payout.read` |
| PUT | `/v1/war/:warId/payout` | `war.payout.manage` |
| PUT | `/v1/war/:warId/payout/members/:tornId` | `war.payout.manage` |
| POST | `/v1/war/:warId/payout/finalize` | `war.payout.manage` |
| POST | `/v1/war/:warId/payout/reopen` | `war.payout.reopen` |
| GET | `/v1/admin/overview` | `admin.read` |
| PUT | `/v1/admin/role-mappings/:factionPosition` | `admin.manage` (Owner only) |
| DELETE | `/v1/admin/role-mappings/:factionPosition?expectedVersion=…` | `admin.manage` (Owner only) |
| PUT | `/v1/admin/users/:userId/suspension` | `admin.manage` (Owner only) |
| POST | `/v1/admin/users/:userId/revoke-sessions` | `admin.manage` (Owner only) |
| GET | `/v1/admin/audit` | `audit.read` |

## Production checklist

See `DEPLOY_RENDER_NEON.md` for the recommended free pilot and `DEPLOYMENT.md` for the general container, HTTPS, PostgreSQL, and production-userscript workflow.

- Serve only behind HTTPS; never expose this service over plain HTTP.
- Put encryption keys and JWT secrets in a managed secret store, not `.env` or source control.
- Use a managed PostgreSQL database with TLS, encrypted backups, point-in-time recovery, and restricted credentials.
- Set `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS`, and proxy trust precisely. On Render, `PUBLIC_BASE_URL` is derived from `RENDER_EXTERNAL_URL`.
- Add a reverse proxy/WAF, monitoring, alerting, centralized redacted logs, dependency scanning, backups, and tested restores.
- Rotate encryption by adding a new key version, switching `KEY_ENCRYPTION_ACTIVE_VERSION`, and re-encrypting rows before retiring the old key.
- Add scheduled faction re-verification and automatic session revocation when a member leaves. Owner-triggered suspension and revocation are already immediate.
- Add CSRF protection if browser cookies replace bearer tokens later.
- Complete a privacy notice and retention policy before collecting member data.
- Do not grant permissions based on client UI, request fields, or cached faction positions.

## Important current limits

This alpha synchronizes faction membership, currently available Recruiting/Planning crimes, the current or most recent ranked war, the current/scheduled opponent roster, outgoing ranked-war attacks, and each connected member's own approved statistics. Battle and drug analytics require explicit consent and a key with the required selections. Members must connect and sync individually; the backend does not impersonate members or bulk-collect private data through another member's key. The Scheduler creates alerts in the userscript while Torn is open; the free pilot does not provide reliable offline push notifications or unattended background synchronization. The Admin tab manages position-to-role mappings but does not create or rename positions inside Torn. It does not yet run the optimizer server-side, provide real-time updates, or transfer money inside Torn. Payout reports calculate and export amounts only; officers still perform actual faction payments manually. The Version 2 optimizer still runs inside Tampermonkey using the shared normalized crime stats.

The Version 3 userscript preserves the planner and optimizer while using the backend as its only Torn-data and credential path. The obsolete Keys tab, local multi-key storage, direct client-to-Torn API calls, and pre-release fictional-data mode have been removed. See `client/INTEGRATION.md` for the merged behavior and production-host configuration.
