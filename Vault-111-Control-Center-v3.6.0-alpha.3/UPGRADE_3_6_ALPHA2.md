# Upgrade to Version 3.6 alpha.2

This is a focused mobile, navigation, Dashboard, and Planner update. Existing OC assignments, users, encrypted API keys, roles, wars, payouts, analytics, announcements, schedule events, and audit history are preserved.

## Included

- Full-width tab navigation without horizontal tab scrolling
- Mobile mounting expanded to common phone and compact tablet viewport sizes
- Stable mobile panel height based on the visual viewport
- On-screen keyboard handling that slides the panel upward and restores it afterward
- Mobile launcher positions are clamped temporarily without corrupting the saved position
- Current Torn faction chain on the Dashboard with a live break/cooldown label
- Correct empty-role count based on actual Torn assignments
- Dashboard Planning Queue removed
- Best Next Crime replaced by the connected member's top suggested OC role
- Planner automatically synchronizes member/faction data and rebuilds when opened
- Five-minute client cooldown prevents repeated Planner-tab synchronization

## Deployment

1. Back up the Neon database.
2. Commit the complete Version 3.6 alpha.2 package to the existing GitHub repository.
3. Let Render deploy the commit. Docker runs `prisma migrate deploy` automatically.
4. The migration adds current-chain summary fields to `FactionSyncState`; it does not modify existing rows outside that table.
5. Open:

   ```text
   https://vault111-control-center.onrender.com/health
   ```

   Expected:

   ```json
   {"ok":true,"version":"3.6.0-alpha.2","database":"connected"}
   ```

6. Open the userscript raw URL and update Tampermonkey to the new stable `Vault-111-Control-Center.user.js`.
7. As Owner or another role with OC synchronization permission, open **Planner** once. This populates the new current-chain fields and rebuilds the shared plan.
8. Confirm the Dashboard shows the current chain and a nonzero Torn vacancy count when empty OC slots exist.
9. On a phone, open an input field, open and close the keyboard, and confirm the panel returns to its original position and size.

The current-chain data comes from Torn API v2's `/faction/chain` selection and is refreshed with the normal faction/OC synchronization.
