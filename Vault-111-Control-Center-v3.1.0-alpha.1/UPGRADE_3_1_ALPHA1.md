# Upgrade to Version 3.1 alpha.1

This release starts the Ranked War Tracker module without changing the finished OC Planner workflow.

## What is included

- Current or most recent ranked-war score, target, chain, opponent, status, and timing
- Outgoing ranked-war attack ingestion with exact ranked-war and opponent filtering
- Member participation totals, successful hits, assists, failed attacks, respect, and recent activity
- A recent ranked-war attack feed
- Read access for all authenticated faction members
- Torn synchronization permission for Owner, Admin, and War Manager
- A separate synchronization lock, rate limit, error state, truncation indicator, and audit entry

Payouts, target management, notes, and unattended scheduled synchronization are deliberately deferred until the read-only tracker has been tested with live war data.

## Deploy

1. Commit and push the complete project, including the new Prisma migration.
2. Let Render deploy the latest commit. The container runs `prisma migrate deploy` before the server starts.
3. Open `/health` and confirm version `3.1.0-alpha.1` with `database: "connected"`.
4. Generate the production userscript:

   ```powershell
   npm run client:configure -- https://vault111-control-center.onrender.com
   ```

5. Publish or install `client/Vault-111-Control-Center-v3.1.0-alpha.1-production.user.js`.
6. Open Torn, reconnect if necessary, and select the new **War** tab.
7. An Owner, Admin, or War Manager presses **Sync Ranked War**. Other members press **Refresh Tracker** to read the shared result.

Existing users, encrypted Torn keys, sessions, role mappings, crime statistics, OC records, and planner assignments are preserved.
