# Vault 111 Control Center — Version 3 alpha.12

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
- Live dashboard Planning Queue countdowns based on Torn's synchronized crime ready times
- Keyboard-accessible tabs and member dialogs, persistent focus/scroll state, reduced-motion support, live status announcements, guarded backend actions, and publication-ready UI polish
- A draggable collapsed launcher, single-instance protection, and a compact mobile layout limited to roughly 40% of the viewport height
- Automatic self-only crime-stat synchronization when an authenticated member opens the API Key screen, with a rate-safe five-minute cooldown
- Safe read-only wake checks for free hosting, without replaying sync or assignment mutations
- Render Blueprint and Neon deployment workflow with separate pooled and migration connections

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
7. Install `client/Vault-111-Control-Center-v3.0.0-alpha.12.user.js` in Tampermonkey.

## First shared synchronization

The Owner, Administrator, or OC Planner must connect with a Torn key that has minimal access and faction API permission. In the userscript’s **API Key** tab, press **Sync Vault 111 from Torn**.

The backend re-verifies the key owner and faction, synchronizes faction members and Recruiting/Planning crimes in one database transaction, and never returns the API key. Regular Members can refresh and read the resulting shared snapshot but cannot start a Torn synchronization.

Every member can use **Sync My Crime Stats**. That endpoint decrypts only the authenticated member's own stored key, re-verifies that same Torn ID and faction, requests Torn's `personalstats` crime category, and publishes only normalized crime totals to the shared planner. It cannot use one member's session to update another member.

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
| POST | `/v1/me/crime-stats/sync` | Authenticated; self only |
| GET | `/v1/me/crime-stats` | Authenticated; self only |
| POST | `/v1/faction/sync` | `oc.sync` |
| GET | `/v1/faction/members` | `oc.read` |
| GET | `/v1/oc/snapshot` | `oc.read` |
| GET | `/v1/oc/crimes` | `oc.read` |
| PUT | `/v1/oc/crimes/:crimeId/roles/:roleKey` | `oc.assign` |
| GET | `/v1/admin/audit` | `audit.read` |

## Production checklist

See `DEPLOY_RENDER_NEON.md` for the recommended free pilot and `DEPLOYMENT.md` for the general container, HTTPS, PostgreSQL, and production-userscript workflow.

- Serve only behind HTTPS; never expose this service over plain HTTP.
- Put encryption keys and JWT secrets in a managed secret store, not `.env` or source control.
- Use a managed PostgreSQL database with TLS, encrypted backups, point-in-time recovery, and restricted credentials.
- Set `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS`, and proxy trust precisely. On Render, `PUBLIC_BASE_URL` is derived from `RENDER_EXTERNAL_URL`.
- Add a reverse proxy/WAF, monitoring, alerting, centralized redacted logs, dependency scanning, backups, and tested restores.
- Rotate encryption by adding a new key version, switching `KEY_ENCRYPTION_ACTIVE_VERSION`, and re-encrypting rows before retiring the old key.
- Add scheduled faction re-verification and immediate session revocation when a member leaves or is suspended.
- Add CSRF protection if browser cookies replace bearer tokens later.
- Complete a privacy notice and retention policy before collecting member data.
- Do not grant permissions based on client UI, request fields, or cached faction positions.

## Important current limits

This alpha synchronizes faction membership, currently available Recruiting/Planning crimes, and each consenting connected member's own Torn crime-category stats. Members must connect and sync individually; the backend does not impersonate members or bulk-collect private data through another member's key. It does not yet schedule unattended syncs, run the optimizer server-side, expose role-management UI, or provide real-time updates. The Version 2 optimizer still runs inside Tampermonkey using the shared normalized stats.

The Version 3 userscript preserves the planner and optimizer while using the backend as its only Torn-data and credential path. The obsolete Keys tab, local multi-key storage, direct client-to-Torn API calls, and pre-release fictional-data mode have been removed. See `client/INTEGRATION.md` for the merged behavior and production-host configuration.
