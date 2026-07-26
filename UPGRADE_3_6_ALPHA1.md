# Upgrade to Version 3.6 alpha.1

This release adds the protected Administration & Permissions module. It preserves the OC Planner, Ranked War Tracker, target notes, payout calculator, Member Overview, Dashboard, Announcements, Scheduler, and notifications.

## Included

- Administration tab visible only to the authenticated Owner and Administrators
- Faction-position role mappings with current member counts
- Safe user access overview showing roles, connection status, analytics consent, active-session counts, and latest verification
- Synchronization and database health summaries
- Faction-scoped audit history without IP hashes or credential material
- Owner-only mapping create/update/delete controls
- Owner-only account suspension, restoration, and session revocation
- Administrators remain read-only
- Owner accounts cannot be assigned through mappings or managed through the UI
- Immediate access-token invalidation through server-checked session versions
- Optimistic versions and audit events for every administrative mutation
- Warning markers for connected users absent from the latest faction synchronization

## Deployment

1. Back up the Neon database.
2. Commit the complete Version 3.6 alpha.1 package to the existing GitHub repository.
3. Let Render deploy the commit. The Docker startup command runs `prisma migrate deploy`.
4. The migration adds:

   - `User.sessionVersion`
   - `User.adminVersion`
   - `RoleMapping.version`

5. Open:

   ```text
   https://vault111-control-center.onrender.com/health
   ```

   Expected:

   ```json
   {"ok":true,"version":"3.6.0-alpha.1","database":"connected"}
   ```

6. Publish `client/Vault-111-Control-Center-v3.6.0-alpha.1-production.user.js` as the repository's stable `Vault-111-Control-Center.user.js`.
7. Update the userscript and reconnect if prompted. Tokens created before this release do not contain a session-version claim, so the existing refresh token may be used once to obtain a current access token.
8. As Owner, open **Admin** and verify existing faction-position mappings before changing anything.
9. Save one noncritical mapping and confirm affected users are signed out and receive the correct role after reconnecting.
10. Sign in as an Administrator and confirm the Admin tab is read-only.
11. Confirm regular Members have no Admin tab and receive `403` for direct Admin mutation requests.

## Important behavior

- Role mappings apply to exact Torn faction-position names.
- Removing a mapping changes affected non-Owner users to read-only Member access.
- Saving or removing a mapping revokes affected sessions.
- Suspending access takes effect immediately and prevents login.
- Restoring access does not recreate a session; the member reconnects with their own API key.
- Stored API keys remain encrypted and are never returned by the Admin API.

The migration does not alter or decrypt API keys and does not modify OC records, wars, payouts, analytics, announcements, scheduled events, notification preferences, or existing audit history.
