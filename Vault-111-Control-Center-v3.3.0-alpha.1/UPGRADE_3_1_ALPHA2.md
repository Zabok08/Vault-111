# Upgrade to Version 3.1 alpha.2

This update adds the shared ranked-war target list and officer notes. It does not add participation requirements and does not change the completed OC Planner.

## Included

- Current/scheduled opponent roster from Torn's public faction-member endpoint
- Target name, ID, level, position, status, hospital timing, last action, and revivable state
- Search plus All, Okay, Hospitalized, and With notes filters
- Direct Torn Attack and Profile links
- Shared per-target notes
- Note editing for Owner, Admin, War Manager, and Officer
- Read-only target notes for Members and OC Planners
- Optimistic note versions that prevent silent overwrites
- Audit entries containing the target and note length, but not the private note text
- Synchronization that refreshes Torn fields without overwriting officer notes

## Deploy

1. Commit and push the complete project, including `prisma/migrations/20260725110000_war_targets_notes/migration.sql`.
2. Let Render deploy the commit. Its startup command applies the migration automatically.
3. Confirm `/health` reports `3.1.0-alpha.2` and `database: "connected"`.
4. Generate or use the production userscript configured for the existing Render address:

   ```powershell
   npm run client:configure -- https://vault111-control-center.onrender.com
   ```

5. Install or publish `client/Vault-111-Control-Center-v3.1.0-alpha.2-production.user.js`.
6. An Owner, Admin, or War Manager uses **Sync Ranked War** once to populate the opponent roster.

Existing users, sessions, encrypted Torn keys, roles, OC data, crime statistics, war attacks, and assignments are preserved.
