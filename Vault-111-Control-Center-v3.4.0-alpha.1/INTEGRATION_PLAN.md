# Version 3 integration plan

## Phase 3.0A — security foundation (this package)

- Deploy PostgreSQL and the API behind HTTPS.
- Configure secrets in a secret manager.
- Verify login, faction membership, encrypted key storage, token rotation, RBAC, assignment concurrency, and audit events.
- Bootstrap one owner, then map Torn faction positions to application roles.
- Run a limited officer-only pilot before allowing general member login.

Exit criteria: threat-model review complete, restore test complete, no secrets in logs, permission tests cover every write endpoint.

## Phase 3.0B — Torn ingestion (core implemented through alpha.14)

- Add one rate-budgeted sync worker. (Protected manual sync and overlap lock implemented; scheduler pending.)
- Validate Torn responses with strict schemas. (Implemented.)
- Sync faction members and OC records transactionally. (Implemented.)
- Re-verify membership and position before privileged sync and later on a schedule. (Privileged sync implemented; scheduler pending.)
- Revoke sessions and stop collection when a member leaves.
- Store only fields needed for planning and document retention periods.
- Let each authenticated member explicitly synchronize only their own crime-category stats. (Implemented.)
- Display synchronized OC ready times as live Planning Queue countdowns in the Tampermonkey dashboard. (Implemented.)

Exit criteria: repeatable sync, safe handling of partial/changed Torn responses, no overlapping jobs, clear stale-data indicator.

## Phase 3.0C — shared OC planning

- Move shared assignments and locks to REST endpoints.
- Retain the Version 2 optimizer in Tampermonkey initially.
- Submit proposed optimized plans as atomic server transactions.
- Add conflict resolution, change history, notes, and officer/member views.
- Add Server-Sent Events for read-only live updates after REST behavior is stable.

Exit criteria: two officers cannot silently overwrite one another; all members see the same approved plan; unauthorized writes consistently return `403`.

## Phase 3.0D — client merge (shared snapshot merge complete)

- Keep the backend connection merged into the single-file planner userscript.
- Add Connect/Disconnect and connection-health UI.
- Remove pre-release fictional data and test controls before distribution. (Implemented.)
- Show permissions from `/v1/me`; never infer them from visible Torn page content.
- Keep the last shared snapshot readable when the backend is temporarily unavailable.
- Remove old multi-member key import and direct client-to-Torn requests; ensure exports never contain credentials. (Implemented.)
- Complete the keyboard, focus, live-status, reduced-motion, refresh-stability, and final theme pass before public distribution. (Implemented.)

Exit criteria: members still install one `.user.js`; backend outages do not break Torn; no client control is treated as a security boundary.

## Phase 3.1 — war tracker

- Add separate ranked-war, attack, and synchronization-state tables. (Implemented in alpha.1.)
- Reuse encrypted member keys and re-verify identity/faction before privileged synchronization. (Implemented.)
- Restrict synchronization to Owner, Admin, and War Manager while permitting faction-wide read-only access. (Implemented.)
- Normalize current/latest ranked war and outgoing ranked-war attacks with bounded pagination. (Implemented.)
- Add a Tampermonkey War tab for score, timing, participation, and recent attacks. (Implemented.)
- Synchronize the current/scheduled opponent roster and preserve shared per-target officer notes. (Implemented in alpha.2.)
- Add scheduled rate-budgeted refresh and payout configuration only after manual sync has proven reliable.

Exit criteria: exact ranked-war filtering, reliable score and attack ingestion, no duplicate attacks, readable stale/truncated state, and consistent `403` responses for unauthorized sync requests.

## Phase 3.3 — member overview and analytics

- Add explicit per-member consent and self-only synchronization for battle stats, drug totals, and cooldowns. (Implemented.)
- Store normalized current values plus six-hour snapshots rather than Torn log data. (Implemented.)
- Restrict exact analytics to the member, Owner, and Administrator on the backend. (Implemented.)
- Audit privileged analytics reads and consent changes. (Implemented.)
- Add searchable status, availability, last-action, battle-stat, drug, cooldown, and growth views to the Members tab. (Implemented.)
- Delete current analytics and history when consent is withdrawn. (Implemented.)

Exit criteria: no cross-member sync target, no exact private data for unauthorized roles, bounded history growth, successful migration, accessible mobile UI, and verified deletion on consent withdrawal.

## Phase 3.4 — unified dashboard and announcements

- Aggregate current OC, war, payout, member-availability, and synchronization health into one bounded dashboard response. (Implemented.)
- Preserve the existing local optimizer readiness cards and Planning Queue. (Implemented.)
- Add faction-scoped pinned and expiring announcements. (Implemented.)
- Restrict announcement management to Owner, Administrator, and Officer while every connected role remains read-only. (Implemented.)
- Validate and escape announcement content, prevent silent concurrent overwrites, and audit every mutation. (Implemented.)
- Keep the desktop and mobile dashboard compact enough for the existing in-Torn panel. (Implemented.)

Exit criteria: all roles can load the same overview, unauthorized announcement writes return `403`, conflicts return `409`, expired announcements disappear, and existing modules remain accessible.
