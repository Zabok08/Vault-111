# Upgrade to Version 3.4 alpha.1

This release adds the unified Faction Dashboard and shared Announcements module. It preserves the OC Planner, Ranked War Tracker, target notes, payout calculator, and Member Overview.

## Included

- Ranked-war score, opponent, and live start/end timing on the main Dashboard
- Available, hospitalized, traveling, inactive, and OC-occupied member summaries
- Latest finalized ranked-war payout total and member count
- Canonical Planning, Recruiting, ready-time, and open Torn slot counts
- Faction, war, and member-analytics synchronization health
- Pinned and expiring faction announcements
- Owner, Administrator, and Officer announcement management
- Read-only announcement access for every other connected faction role
- Optimistic version protection, bounded plain-text content, same-faction enforcement, rate limits, and audit events
- Compact mobile dashboard and announcement layouts

## Deployment

1. Back up the Neon database.
2. Commit the complete Version 3.4 alpha.1 package to the existing GitHub repository.
3. Let Render deploy the commit. The Docker startup command runs `prisma migrate deploy` and creates the new `Announcement` table.
4. Open:

   ```text
   https://vault111-control-center.onrender.com/health
   ```

   Expected:

   ```json
   {"ok":true,"version":"3.4.0-alpha.1","database":"connected"}
   ```

5. Publish `client/Vault-111-Control-Center-v3.4.0-alpha.1-production.user.js` as the repository's stable `Vault-111-Control-Center.user.js`.
6. Install or update the userscript, open the Dashboard, and confirm that the faction overview loads.
7. As Owner, Administrator, or Officer, publish a short test announcement. Confirm that a regular Member can read it but does not receive editing controls.

The migration adds only the `Announcement` table and its indexes/foreign keys. It does not alter API keys, sessions, OC records, wars, payouts, member analytics, permissions mappings, or existing audit history.
