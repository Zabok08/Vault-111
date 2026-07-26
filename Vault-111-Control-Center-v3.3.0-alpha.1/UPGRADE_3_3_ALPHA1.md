# Upgrade to Version 3.3 alpha.1

This release adds the opt-in Member Overview & Analytics module. It preserves the OC Planner, Ranked War Tracker, target notes, and payout calculator.

## Included

- Searchable faction member overview with Torn status, last action, travel/hospital grouping, and OC availability
- Self-only battle-stat synchronization through `user:battlestats`
- Per-drug totals, overdoses, rehabilitation count/fees, and current drug cooldown
- Six-hour snapshots and previous-sync, 24-hour, 7-day, and 30-day growth calculations
- Explicit consent during first connection and a separate enable action for existing sessions
- One-click consent withdrawal that deletes the member's current analytics and snapshot history
- Exact analytics returned only to the member, Owner, and Administrators
- Audit events for consent changes, synchronization, and privileged all-member reads
- Mobile member cards, privacy placeholders, filters, and accessible member dialogs

## Required Torn key access

A Limited key works. A custom key should include:

- `user:basic`
- `user:faction`
- `user:personalstats`
- `user:cooldowns`
- `user:battlestats`

Existing narrower custom keys can still connect and use the planner, but missing analytics selections are reported on the API Key screen.

## Deployment

1. Back up Neon before deploying the schema migration.
2. Commit the complete Version 3.3 package to the existing GitHub repository.
3. Let Render deploy the commit. The Docker startup command runs `prisma migrate deploy`.
4. Confirm:

   ```text
   https://vault111-control-center.onrender.com/health
   ```

   Expected:

   ```json
   {"ok":true,"version":"3.3.0-alpha.1","database":"connected"}
   ```

5. Install `client/Vault-111-Control-Center-v3.3.0-alpha.1-production.user.js`, or publish it as the repository's stable `Vault-111-Control-Center.user.js`.
6. Existing connected members open **API Key**, review the disclosure, and press **Enable Analytics Tracking** if they choose to participate.

The migration adds only the analytics consent field and new analytics tables. It does not alter encrypted API keys, sessions, OC data, war data, notes, payouts, role mappings, or audit history.
