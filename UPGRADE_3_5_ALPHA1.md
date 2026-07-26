# Upgrade to Version 3.5 alpha.1

This release adds the shared Faction Scheduler and per-member notifications. It preserves the OC Planner, Ranked War Tracker, target notes, payout calculator, Member Overview, unified Dashboard, and Announcements.

## Included

- Manual Chain, Ranked War, Organized Crime, Faction, Meeting, and Other events
- Automatic read-only events for synchronized Ranked War starts and OC ready times
- Shared upcoming-event list and live countdowns on the Dashboard
- Owner, Administrator, and Officer management of every event type
- War Manager management of Chain and Ranked War events
- OC Planner management of Organized Crime events
- Read-only schedule access for regular Members
- Per-member event-type and reminder-minute preferences
- Deduplicated in-app alerts and optional Tampermonkey browser notifications while Torn is open
- Version-conflict protection, bounded dates/content, rate limits, retention cleanup, and audit events

## Deployment

1. Back up the Neon database.
2. Commit the complete Version 3.5 alpha.1 package to the existing GitHub repository.
3. Let Render deploy the commit. The Docker startup command runs `prisma migrate deploy` and creates the `ScheduleEvent`, `NotificationPreference`, and `ScheduleEventType` database objects.
4. Open:

   ```text
   https://vault111-control-center.onrender.com/health
   ```

   Expected:

   ```json
   {"ok":true,"version":"3.5.0-alpha.1","database":"connected"}
   ```

5. Publish `client/Vault-111-Control-Center-v3.5.0-alpha.1-production.user.js` as the repository's stable `Vault-111-Control-Center.user.js`.
6. Install or update the userscript and open the new **Schedule** tab.
7. As Owner, Administrator, or Officer, create a short test event. Confirm that a regular Member can read it but cannot edit it.
8. Save personal notification preferences, then verify an in-app reminder with Torn open.
9. Synchronize faction/OC and Ranked War data and confirm future OC-ready and Ranked War events appear automatically.

The migration adds scheduler objects and user relations only. It does not alter encrypted API keys, sessions, OC records, wars, payouts, member analytics, announcements, role mappings, or existing audit history.

## Notification limit

The free Render pilot does not run an always-awake push worker. In-app and Tampermonkey browser notifications are delivered while Torn is open and the userscript is running. A future worker and push service would be required for reliable alerts while every Torn tab is closed.
